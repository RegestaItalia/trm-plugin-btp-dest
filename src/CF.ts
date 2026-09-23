import axios, { isAxiosError } from "axios";
import { serviceToken } from "@sap-cloud-sdk/connectivity";
import { CfRefreshTokenExpiredError, getErrorReason, getHttpStatus } from "./errors";
import { getCommons } from "./commons";

export class CF {

    private _cfRequestHeaders: any;
    private _cfInfo: any;
    private _loggedIn: boolean = false;
    protected _apiEndpoint!: string;
    protected _loginEndpoint!: string;
    protected _username?: string;
    protected _password?: string;
    protected _refreshToken?: string;

    private constructor() { }

    private static getEndpoints(region: string) {
        if (!region) {
            throw new Error(`Cloud Foundry region is missing.`);
        }
        return {
            apiEndpoint: `https://api.cf.${region}.hana.ondemand.com`,
            loginEndpoint: `https://login.cf.${region}.hana.ondemand.com`
        }
    }
    public static fromLogin(username: string, password: string, region: string): CF {
        const endpoints = CF.getEndpoints(region);
        var instance = new CF();
        instance._username = username;
        instance._password = password;
        instance._apiEndpoint = endpoints.apiEndpoint;
        instance._loginEndpoint = endpoints.loginEndpoint;
        return instance;
    }
    public static fromRefreshToken(region: string, refreshToken: string): CF {
        const endpoints = CF.getEndpoints(region);
        var instance = new CF();
        instance._apiEndpoint = endpoints.apiEndpoint;
        instance._loginEndpoint = endpoints.loginEndpoint;
        instance._refreshToken = refreshToken;
        return instance;
    }

    public async getInfo(): Promise<any> {
        if (!this._cfInfo) {
            try {
                this._cfInfo = (await axios.get(`${this._apiEndpoint}/v2/info`)).data;
            } catch (e) {
                throw new Error(`Couldn't read Cloud Foundry info from ${this._apiEndpoint} (${getErrorReason(e)}).`);
            }
        }
        return this._cfInfo;
    }

    // latest refresh token (the login server may rotate it on each refresh), undefined if never set
    public peekRefreshToken(): string | undefined {
        return this._refreshToken;
    }

    public getRefreshToken(): string {
        if (!this._refreshToken) {
            throw new Error(`Cloud Foundry refresh token not available, login first.`);
        }
        return this._refreshToken;
    }

    private async passwordLogin(): Promise<any> {
        try {
            return (await axios.post(`${this._loginEndpoint}/oauth/token`, new URLSearchParams({
                grant_type: "password",
                username: this._username!,
                password: this._password!
            }), {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": "Basic " + Buffer.from("cf:").toString("base64"),
                }
            })).data;
        } catch (e) {
            const status = getHttpStatus(e);
            if (status === 401 || status === 400) {
                throw new Error(`Cloud Foundry login failed: invalid email or password, or user without access to Cloud Foundry (${getErrorReason(e)}).`);
            }
            throw new Error(`Cloud Foundry login failed (${getErrorReason(e)}).`);
        }
    }

    private async refreshLogin(): Promise<any> {
        if (!this._refreshToken) {
            throw new Error(`Cloud Foundry refresh token is missing.`);
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
            if (isAxiosError(e) && e.response?.status === 401 && e.response.data?.error === 'invalid_token') {
                throw new CfRefreshTokenExpiredError();
            }
            throw new Error(`Cloud Foundry login failed (${getErrorReason(e)}).`);
        }
    }

    public async login(): Promise<void> {
        if (this._loggedIn) {
            return;
        }
        var cfLogin: any;
        if (this._username && this._password) {
            cfLogin = await this.passwordLogin();
        } else {
            cfLogin = await this.refreshLogin();
        }
        if (!cfLogin?.access_token) {
            throw new Error(`Cloud Foundry login failed: no access token returned.`);
        }
        this._cfRequestHeaders = {
            'Authorization': `Bearer ${cfLogin.access_token}`
        };
        if (cfLogin.refresh_token) {
            this._refreshToken = cfLogin.refresh_token;
            const expiration = CF.getTokenExpiration(cfLogin.refresh_token);
            if (expiration) {
                getCommons().Logger.info(`Cloud Foundry session valid until ${expiration.toLocaleString()}.`);
            }
        }
        this._loggedIn = true;
    }

    // expiration of a JWT token (exp claim), undefined for opaque tokens
    private static getTokenExpiration(token: string): Date | undefined {
        try {
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
            return typeof payload.exp === 'number' ? new Date(payload.exp * 1000) : undefined;
        } catch {
            return undefined;
        }
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
            throw new Error(`Couldn't search Cloud Foundry app "${appName}" (${getErrorReason(e)}).`);
        }
    }

    public async isSshEnabled(appGuid: string): Promise<{ enabled: boolean, reason: string }> {
        try {
            return (await axios.get(`${this._apiEndpoint}/v3/apps/${appGuid}/ssh_enabled`, {
                headers: this._cfRequestHeaders
            })).data;
        } catch (e) {
            throw new Error(`Couldn't read app SSH status (${getErrorReason(e)}).`);
        }
    }

    public async getAppEnv(appGuid: string): Promise<any> {
        try {
            return (await axios.get(`${this._apiEndpoint}/v3/apps/${appGuid}/env`, {
                headers: this._cfRequestHeaders
            })).data;
        } catch (e) {
            throw new Error(`Couldn't read app environment (${getErrorReason(e)}).`);
        }
    }

    public async getDestinations(service: any): Promise<any[]> {
        var destinationsToken: string;
        try {
            destinationsToken = await serviceToken(service);
        } catch (e) {
            throw new Error(`Couldn't get a token for the Destination service (${getErrorReason(e)}).`);
        }
        try {
            var destinations: any[] = [];
            var currentDests: any[];
            var currentPage = 1;
            do {
                currentDests = (await axios.get(`${service.credentials.uri}/destination-configuration/v1/subaccountDestinations?$includeMetadata=modification_time%3Betag&$select=Name&$page=${currentPage}&$pageSize=100`, {
                    headers: {
                        'Authorization': `Bearer ${destinationsToken}`
                    }
                })).data || [];
                currentPage++;
                destinations = destinations.concat(currentDests);
            } while (currentDests.length > 0);
            return destinations;
        } catch (e) {
            throw new Error(`Couldn't read subaccount destinations (${getErrorReason(e)}).`);
        }
    }

    public async getSshPassword(): Promise<string> {
        const cfInfo = await this.getInfo();
        if (!cfInfo.token_endpoint || !cfInfo.app_ssh_oauth_client) {
            throw new Error(`Cloud Foundry info doesn't expose SSH authentication data.`);
        }
        let code: string | null;
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
            code = new URL(sshCode.headers.location).searchParams.get("code");
        } catch (e) {
            throw new Error(`Couldn't get SSH one-time code from Cloud Foundry (${getErrorReason(e)}).`);
        }
        if (!code) {
            throw new Error(`Couldn't get SSH one-time code from Cloud Foundry: no code returned.`);
        }
        return code;
    }

}
