import axios from "axios";
import { serviceToken } from "@sap-cloud-sdk/connectivity";

export class CF {

    private _cfRequestHeaders: any;
    private _cfInfo: any;
    private _loggedIn: boolean = false;
    protected _apiEndpoint: string;
    protected _loginEndpoint: string;
    protected _username: string;
    protected _password: string;
    protected _refreshToken: string;

    private constructor() { }

    private static getEndpoints(region: string) {
        return {
            apiEndpoint: `https://api.cf.${region}.hana.ondemand.com`,
            loginEndpoint: `https://login.cf.${region}.hana.ondemand.com`
        }
    }
    public static fromLogin(username: string, password: string, region: string): CF {
        var instance = new CF();
        instance._username = username;
        instance._password = password;
        instance._apiEndpoint = CF.getEndpoints(region).apiEndpoint;
        instance._loginEndpoint = CF.getEndpoints(region).loginEndpoint;
        return instance;
    }
    public static fromRefreshToken(region: string, refreshToken: string): CF {
        var instance = new CF();
        instance._apiEndpoint = CF.getEndpoints(region).apiEndpoint;
        instance._loginEndpoint = CF.getEndpoints(region).loginEndpoint;
        instance._refreshToken = refreshToken;
        return instance;
    }

    public async getInfo(): Promise<any> {
        if (!this._cfInfo) {
            try {
                this._cfInfo = (await axios.get(`${this._apiEndpoint}/v2/info`)).data;
            } catch (e) {
                throw new Error(`Couldn't read Cloud Foundry info data.`);
            }
        }
        return this._cfInfo;
    }

    public getRefreshToken(): string {
        return this._refreshToken;
    }

    private async refreshLogin(): Promise<any> {
        if (!this._refreshToken) {
            throw new Error(`Missing refresh token!`);
        }
        try {
            return (await axios.post(`${this._loginEndpoint}/oauth/token`, new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: this._refreshToken
            }), {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": "Basic " + Buffer.from("cf:").toString("base64"),
                }
            })).data;
        } catch (e) {
            throw new Error(`Cloud Foundry login failed.`);
        }
    }

    public async login(): Promise<void> {
        if (this._loggedIn) {
            return;
        }
        var cfLogin: any;
        if (this._username && this._password) {
            try {
                cfLogin = (await axios.post(`${this._loginEndpoint}/oauth/token`, new URLSearchParams({
                    grant_type: "password",
                    username: this._username,
                    password: this._password
                }), {
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Authorization": "Basic " + Buffer.from("cf:").toString("base64"),
                    }
                })).data;
            } catch (e) {
                throw new Error(`Cloud Foundry login failed.`);
            }
        } else {
            cfLogin = await this.refreshLogin();
        }
        this._cfRequestHeaders = {
            'Authorization': `Bearer ${cfLogin.access_token}`
        };
        this._refreshToken = cfLogin.refresh_token;
        this._loggedIn = true;
    }

    public async getApps(appName: string): Promise<any[]> {
        try {
            return (await axios.get(`${this._apiEndpoint}/v3/apps`, {
                params: {
                    names: appName
                },
                headers: this._cfRequestHeaders
            })).data.resources || [];
        } catch (e) {
            throw new Error(`App "${appName}" not found.`);
        }
    }

    public async isSshEnabled(appGuid: string): Promise<{ enabled: boolean, reason: string }> {
        try {
            return (await axios.get(`${this._apiEndpoint}/v3/apps/${appGuid}/ssh_enabled`, {
                headers: this._cfRequestHeaders
            })).data;
        } catch (e) {
            throw new Error(`Couldn't read app ssh status.`);
        }
    }

    public async getAppEnv(appGuid: string): Promise<any> {
        try {
            return (await axios.get(`${this._apiEndpoint}/v3/apps/${appGuid}/env`, {
                headers: this._cfRequestHeaders
            })).data;
        } catch (e) {
            throw new Error(`Couldn't read app environment.`);
        }
    }

    public async getDestinations(service: any): Promise<any[]> {
        try {
            var destinations: any[] = [];
            const destinationsToken = await serviceToken(service);
            var currentDests: any[];
            var currentPage = 1;
            do {
                currentDests = (await axios.get(`${service.credentials.uri}/destination-configuration/v1/subaccountDestinations?$includeMetadata=modification_time%3Betag&$select=Name&$page=${currentPage}&$pageSize=100`, {
                    headers: {
                        'Authorization': `Bearer ${destinationsToken}`
                    }
                })).data;
                currentPage++;
                destinations = destinations.concat(currentDests);
            } while (currentDests.length > 0);
            return destinations;
        } catch (e) {
            throw new Error(`Couldn't read destinations`);
        }
    }

    public async getSshPassword() {
        const cfInfo = await this.getInfo();
        try {
            const sshCode = await axios.get(`${cfInfo.token_endpoint}/oauth/authorize`, {
                params: {
                    client_id: cfInfo.app_ssh_oauth_client,
                    response_type: "code"
                },
                headers: this._cfRequestHeaders,
                maxRedirects: 0,
                validateStatus: (s) => s === 302,
            });
            return new URL(sshCode.headers.location).searchParams.get("code");
        } catch (e) {
            throw new Error(`Couldn't authenticate ssh tunnel`);
        }
    }

}