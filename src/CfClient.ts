import { Client as SSHClient } from "ssh2";
import net from "node:net";
import { Logger } from "trm-commons";
import { getSapCfAxiosInstance } from "sap-cf-axios";
import { BtpConnection } from "./BTPSystemConnector";
import { CF } from "./CF";
import { getCore } from './core';
import type { Login, RFCDEST } from "trm-core";

const Core = getCore();

const AXIOS_CTX = "RestServer";
type Forward = { localPort: number; remoteHost: string; remotePort: number; localHost?: string };

export class CfClient extends Core.RESTClient {

    private _cf: CF;

    private _vcapServices: any;
    private _remoteHost: string;
    private _sshUsername: string;

    private _sshClient: SSHClient;
    private _servers: net.Server[];

    constructor(endpoint: string, rfcdest: RFCDEST, destinationLogin: Login, destinationLangu: string, private _btpConnection: BtpConnection) {
        super(endpoint, rfcdest, destinationLogin, destinationLangu);
        this._cf = CF.fromRefreshToken(this._btpConnection.cfRegion, this._btpConnection.cfRefreshToken);
        try {
            this._vcapServices = JSON.parse(this._btpConnection.vcapServices);
            this._remoteHost = this._vcapServices.connectivity[0].credentials.onpremise_proxy_host;
        } catch (e) {

        }
        this._sshUsername = `cf:${this._btpConnection.guid}/0`;
    }

    private async openTunnel(host: string, port: number, username: string, password: string, forwards: Forward[]): Promise<{ conn: SSHClient; servers: net.Server[] }> {
        return new Promise<{ conn: SSHClient; servers: net.Server[] }>((resolve, reject) => {
            const conn = new SSHClient();

            conn.on("ready", () => {
                const servers: net.Server[] = [];

                for (const fwd of forwards) {
                    const localHost = fwd.localHost ?? "127.0.0.1";
                    const server = net.createServer((socket) => {
                        conn.forwardOut(
                            socket.remoteAddress || "127.0.0.1",
                            socket.remotePort || 0,
                            fwd.remoteHost,
                            fwd.remotePort,
                            (err, stream) => {
                                if (err) {
                                    socket.destroy();
                                    return;
                                }
                                socket.pipe(stream).pipe(socket);
                            }
                        );
                    });

                    server.on("error", (e) => {
                        Logger.error(`Local forward ${localHost}:${fwd.localPort} error: ${e.toString()}`, true);
                    });

                    server.listen(fwd.localPort, localHost, () => {
                        Logger.log(`Tunnel listening: ${localHost}:${fwd.localPort} -> ${fwd.remoteHost}:${fwd.remotePort}`, true);
                    });

                    servers.push(server);

                    if (!fwd.localHost) {
                        const v6 = net.createServer((socket) => {
                            conn.forwardOut(
                                socket.remoteAddress || "::1",
                                socket.remotePort || 0,
                                fwd.remoteHost,
                                fwd.remotePort,
                                (err, stream) => {
                                    if (err) {
                                        socket.destroy();
                                        return;
                                    }
                                    socket.pipe(stream).pipe(socket);
                                }
                            );
                        });
                        v6.on("error", () => {/* ignore if IPv6 not available */ });
                        v6.listen(fwd.localPort, "::1");
                        servers.push(v6);
                    }
                }

                resolve({ conn, servers });
            });

            conn.on("error", reject);

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

    private async getSshPassword(): Promise<string> {
        await this._cf.login();
        return this._cf.getSshPassword();
    }

    private async getSshConnectionData(): Promise<{ host: string, port: number, fingerprint: string }> {
        const cfInfo = await this._cf.getInfo();
        return {
            host: cfInfo.app_ssh_endpoint.split(':')[0],
            port: parseInt(cfInfo.app_ssh_endpoint.split(':')[1]),
            fingerprint: cfInfo.app_ssh_host_key_fingerprint
        }
    }

    public async open() {
        this._vcapServices.connectivity[0].credentials.onpremise_proxy_host = "localhost";
        if ("onpremise_proxy_http_host" in this._vcapServices.connectivity[0].credentials) {
            this._vcapServices.connectivity[0].credentials.onpremise_proxy_http_host = "localhost";
        }
        (this._vcapServices.connectivity[0].credentials as any).onpremise_socks5_proxy_host = "localhost";
        process.env.VCAP_SERVICES = JSON.stringify(this._vcapServices);

        Logger.loading(`Authenticating ssh tunnel...`);
        const sshPassword = await this.getSshPassword();
        Logger.loading(`Opening ssh tunnel...`);
        const sshConnectionData = await this.getSshConnectionData();
        ({ conn: this._sshClient, servers: this._servers } = await this.openTunnel(sshConnectionData.host, sshConnectionData.port, this._sshUsername, sshPassword, [{
            localPort: 20003,
            remoteHost: this._remoteHost,
            remotePort: 20003
        }, {
            localPort: 20004,
            remoteHost: this._remoteHost,
            remotePort: 20004
        }]
        ));
        Logger.success(`Ssh tunnel OK!`);
        const client = getSapCfAxiosInstance(this._btpConnection.btpDestinationName);
        client.interceptors.request.use((request) => {
            request.url = `${this.endpoint}${request.url}`;
            return request;
        })
        this._axiosInstance = Core.getAxiosInstance({}, AXIOS_CTX, client);
    }

    public async closeTunnel() {
        if (this._servers) {
            this._servers.forEach(s => s.close());
        }
        if (this._sshClient) {
            this._sshClient.end();
        }
    }

}