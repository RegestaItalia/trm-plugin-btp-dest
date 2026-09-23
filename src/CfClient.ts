import { Client as SSHClient } from "ssh2";
import net from "node:net";
import axios, { AxiosInstance } from "axios";
import { buildHeadersForDestination, getDestination } from "@sap-cloud-sdk/connectivity";
import type { BtpConnection } from "./BTPSystemConnector";
import { CF } from "./CF";
import { getCore } from './core';
import { getCommons } from "./commons";
import { getErrorReason } from "./errors";
import type { Login, RFCDEST } from "trm-core";

const Core = getCore();

const AXIOS_CTX = "RestServer";
// connectivity proxy ports: 20003 HTTP, 20004 SOCKS5
const PROXY_PORTS = [20003, 20004];
type Forward = { localPort: number; remoteHost: string; remotePort: number; localHost?: string };

export class CfClient extends Core.RESTClient {

    private _canOpen: boolean = true;
    private _closing: boolean = false;
    private _cf: CF;
    private _vcapServices: any;
    private _sshUsername: string;

    private _sshClient?: SSHClient;
    private _servers?: net.Server[];

    constructor(endpoint: string, rfcdest: RFCDEST, destinationLogin: Login, destinationLangu: string, private _btpConnection: BtpConnection, cf?: CF) {
        super(endpoint, rfcdest, destinationLogin, destinationLangu);
        // reuse the connection session: refreshing twice may invalidate the saved refresh token
        this._cf = cf || CF.fromRefreshToken(this._btpConnection.cfRegion, this._btpConnection.cfRefreshToken);
        this._sshUsername = `cf:${this._btpConnection.guid}/0`;
    }

    private getConnectivityCredentials(): any {
        // always start from saved data: open() rewrites the proxy host to localhost
        try {
            this._vcapServices = JSON.parse(this._btpConnection.vcapServices);
        } catch (e) {
            throw new Error(`Saved trm-ssh environment is not valid, create the connection again.`);
        }
        const credentials = this._vcapServices?.connectivity?.[0]?.credentials;
        if (!credentials || !credentials.onpremise_proxy_host) {
            throw new Error(`Connectivity service binding not found in trm-ssh environment. Bind a Connectivity service instance to trm-ssh, restage it and create the connection again.`);
        }
        return credentials;
    }

    private createForwardServer(conn: SSHClient, fwd: Forward, sourceHost: string): net.Server {
        return net.createServer((socket) => {
            socket.on("error", (e) => {
                getCommons().Logger.error(`Tunnel socket error on local port ${fwd.localPort}: ${e.message}`, true);
            });
            conn.forwardOut(
                socket.remoteAddress || sourceHost,
                socket.remotePort || 0,
                fwd.remoteHost,
                fwd.remotePort,
                (err, stream) => {
                    if (err) {
                        getCommons().Logger.error(`Tunnel forward to ${fwd.remoteHost}:${fwd.remotePort} failed: ${err.message}`, true);
                        socket.destroy();
                        return;
                    }
                    stream.on("error", (e: Error) => {
                        getCommons().Logger.error(`Tunnel stream error to ${fwd.remoteHost}:${fwd.remotePort}: ${e.message}`, true);
                        socket.destroy();
                    });
                    socket.pipe(stream).pipe(socket);
                }
            );
        });
    }

    private listen(server: net.Server, port: number, host: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const onError = (e: NodeJS.ErrnoException) => {
                if (e.code === 'EADDRINUSE') {
                    reject(new Error(`Local port ${host}:${port} is already in use (another TRM session connected to BTP may be running).`));
                } else {
                    reject(new Error(`Couldn't listen on local port ${host}:${port} (${e.message}).`));
                }
            };
            server.once("error", onError);
            server.listen(port, host, () => {
                server.off("error", onError);
                server.on("error", (e) => {
                    getCommons().Logger.error(`Local forward ${host}:${port} error: ${e.message}`, true);
                });
                getCommons().Logger.log(`Tunnel listening: ${host}:${port}`, true);
                resolve();
            });
        });
    }

    private async startForwards(conn: SSHClient, forwards: Forward[]): Promise<net.Server[]> {
        const servers: net.Server[] = [];
        try {
            for (const fwd of forwards) {
                const localHost = fwd.localHost ?? "127.0.0.1";
                const server = this.createForwardServer(conn, fwd, "127.0.0.1");
                servers.push(server);
                await this.listen(server, fwd.localPort, localHost);

                if (!fwd.localHost) {
                    // "localhost" may resolve to IPv6, best effort
                    const v6 = this.createForwardServer(conn, fwd, "::1");
                    try {
                        await this.listen(v6, fwd.localPort, "::1");
                        servers.push(v6);
                    } catch (e) {
                        getCommons().Logger.log(`IPv6 forward on port ${fwd.localPort} not available: ${(e as Error).message}`, true);
                    }
                }
            }
        } catch (e) {
            servers.forEach(s => s.close());
            throw e;
        }
        return servers;
    }

    private openSsh(host: string, port: number, username: string, password: string): Promise<SSHClient> {
        return new Promise<SSHClient>((resolve, reject) => {
            const conn = new SSHClient();
            var ready = false;

            conn.on("ready", () => {
                ready = true;
                resolve(conn);
            });

            conn.on("error", (e: Error & { level?: string }) => {
                if (!ready) {
                    if (e.level === 'client-authentication') {
                        reject(new Error(`SSH authentication to trm-ssh failed. Check that SSH is enabled for app "trm-ssh" and for its space, and that the app is running.`));
                    } else {
                        reject(new Error(`Couldn't open SSH tunnel to ${host}:${port} (${e.message}).`));
                    }
                } else {
                    getCommons().Logger.error(`SSH tunnel error: ${e.message}`, true);
                }
            });

            conn.on("close", () => {
                if (ready && !this._closing) {
                    getCommons().Logger.warning(`SSH tunnel to trm-ssh closed unexpectedly.`);
                }
            });

            conn.connect({
                host,
                port,
                username,
                password,
                tryKeyboard: true,
                keepaliveInterval: 15000
            });
        });
    }

    // requests go to the destination url through the connectivity proxy (tunnelled), destination and tokens are cached by the sdk
    private getDestinationAxiosInstance(destinationName: string): AxiosInstance {
        const client = axios.create();
        client.interceptors.request.use(async (request) => {
            var destination;
            try {
                destination = await getDestination({ destinationName, useCache: true });
            } catch (e) {
                throw new Error(`Couldn't read destination "${destinationName}" (${getErrorReason(e)}).`);
            }
            if (!destination || !destination.url) {
                throw new Error(`Destination "${destinationName}" not found.`);
            }
            const headers = await buildHeadersForDestination(destination);
            Object.entries(headers).forEach(([key, value]) => request.headers.set(key, value));
            request.baseURL = destination.url;
            if (destination.proxyConfiguration) {
                request.proxy = {
                    host: destination.proxyConfiguration.host,
                    port: destination.proxyConfiguration.port,
                    protocol: destination.proxyConfiguration.protocol || 'http'
                };
            }
            request.url = `${this.endpoint}${request.url}`;
            return request;
        });
        return client;
    }

    private async getSshPassword(): Promise<string> {
        await this._cf.login();
        return this._cf.getSshPassword();
    }

    private async getSshConnectionData(): Promise<{ host: string, port: number, fingerprint: string }> {
        const cfInfo = await this._cf.getInfo();
        const [host, port] = (cfInfo.app_ssh_endpoint || '').split(':');
        if (!host || !port || isNaN(parseInt(port))) {
            throw new Error(`Cloud Foundry info doesn't expose a valid SSH endpoint.`);
        }
        return {
            host,
            port: parseInt(port),
            fingerprint: cfInfo.app_ssh_host_key_fingerprint
        }
    }

    public async open() {
        if (this._canOpen) {
            const Logger = getCommons().Logger;
            const credentials = this.getConnectivityCredentials();
            const remoteHost: string = credentials.onpremise_proxy_host;
            try {
                Logger.loading(`Authenticating SSH tunnel...`);
                const sshPassword = await this.getSshPassword();
                Logger.loading(`Opening SSH tunnel...`);
                const sshConnectionData = await this.getSshConnectionData();
                this._closing = false;
                this._sshClient = await this.openSsh(sshConnectionData.host, sshConnectionData.port, this._sshUsername, sshPassword);
                this._servers = await this.startForwards(this._sshClient, PROXY_PORTS.map(port => ({
                    localPort: port,
                    remoteHost,
                    remotePort: port
                })));
                Logger.success(`SSH tunnel OK!`, true);
                const sessionExpiration = this._cf.getSessionExpiration();
                if (sessionExpiration) {
                    Logger.info(`Cloud Foundry session valid until ${sessionExpiration.toLocaleString()}.`);
                }

                // route connectivity proxy through the tunnel
                credentials.onpremise_proxy_host = "localhost";
                if ("onpremise_proxy_http_host" in credentials) {
                    credentials.onpremise_proxy_http_host = "localhost";
                }
                credentials.onpremise_socks5_proxy_host = "localhost";
                process.env.VCAP_SERVICES = JSON.stringify(this._vcapServices);

                const client = this.getDestinationAxiosInstance(this._btpConnection.btpDestinationName);
                this._axiosInstance = Core.getAxiosInstance({}, AXIOS_CTX, client);

                // connection check and trm-server error messages handling
                Logger.loading(`Connecting to destination "${this._btpConnection.btpDestinationName}"...`);
                try {
                    await super.open();
                } catch (e) {
                    Logger.error(`Couldn't reach trm-server through destination "${this._btpConnection.btpDestinationName}". Check the destination, the Cloud Connector and that trm-server is installed on the target system.`);
                    throw e;
                }
                this._canOpen = false;
            } catch (e) {
                await this.closeTunnel();
                throw e;
            }
        }
    }

    public async closeTunnel() {
        this._closing = true;
        if (this._servers) {
            this._servers.forEach(s => s.close());
            this._servers = undefined;
        }
        if (this._sshClient) {
            this._sshClient.end();
            this._sshClient = undefined;
        }
        this._canOpen = true;
        // base RESTClient state: next open() must check the connection again and set up the new axios instance
        (this as any)._connected = false;
    }

}
