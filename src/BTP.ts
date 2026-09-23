import axios from "axios";
import { getCommons } from "./commons";
import { getErrorReason, getHttpStatus } from "./errors";
import type { SapPassport } from "./SapPassport";

const BTP_CLI_SERVER = "https://cli.btp.cloud.sap";
const BTP_CLI_VERSION = "v2.90.2";

export class BTP {

    private _btpRequestHeaders: any;

    constructor(private _login: { email: string, password: string } | { passport: SapPassport }) { }

    public async login() {
        const sessionId = 'passport' in this._login ? await this.passportLogin(this._login.passport) : await this.passwordLogin(this._login.email, this._login.password);
        if (!sessionId) {
            throw new Error(`BTP login failed: no session returned by BTP.`);
        }
        this._btpRequestHeaders = {
            'x-cpcli-sessionid': sessionId,
            'x-cpcli-format': 'json'
        };
    }

    private async passwordLogin(username: string, password: string): Promise<string | undefined> {
        try {
            const btpLogin = await axios.post(`${BTP_CLI_SERVER}/login/${BTP_CLI_VERSION}`, {
                "customIdp": "",
                "userName": username,
                "password": password,
                "jwt": ""
            });
            return btpLogin.headers['x-cpcli-sessionid'];
        } catch (e) {
            getCommons().Logger.error(String(e), true);
            const status = getHttpStatus(e);
            if (status === 401 || status === 403) {
                throw new Error(`BTP login failed: invalid email or password.`);
            }
            throw new Error(`BTP login failed (${getErrorReason(e)}).`);
        }
    }

    // same as "btp login --sso": the browser part is done with the SAP Passport while the login request waits for it
    private async passportLogin(passport: SapPassport): Promise<string | undefined> {
        const browserLogin = `${BTP_CLI_SERVER}/login/${BTP_CLI_VERSION}/browser`;
        var loginId: string | undefined;
        try {
            loginId = (await axios.get(browserLogin)).data?.loginId;
        } catch (e) {
            throw new Error(`BTP login failed (${getErrorReason(e)}).`);
        }
        if (!loginId) {
            throw new Error(`BTP login failed: no login id returned by BTP.`);
        }
        const session = axios.post(`${browserLogin}/${loginId}`, {
            "customIdp": "",
            "subdomain": ""
        }, { timeout: 120000 });
        session.catch(() => { }); // awaited below
        try {
            passport.reset();
            const confirm = await passport.browse(`${browserLogin}/${loginId}`);
            const complete = confirm.body.match(/href=['"]([^'"]+\/complete\?[^'"]+)['"]/)?.[1];
            if (!complete) {
                throw new Error(`BTP login failed: SAP Passport not accepted by SAP ID service.`);
            }
            await passport.browse(complete.replace(/&amp;/g, '&'));
        } catch (e) {
            axios.get(`${browserLogin}/${loginId}/cancel`).catch(() => { });
            throw e;
        }
        try {
            return (await session).headers['x-cpcli-sessionid'];
        } catch (e) {
            throw new Error(`BTP login failed (${getErrorReason(e)}).`);
        }
    }

    public async getBtpGlobalAccounts(): Promise<any[]> {
        this.checkLoggedIn();
        try {
            return (await axios.post(`${BTP_CLI_SERVER}/client/${BTP_CLI_VERSION}/globalAccountList`, undefined, {
                headers: this._btpRequestHeaders
            })).data || [];
        } catch (e) {
            throw new Error(`Couldn't read BTP global accounts (${getErrorReason(e)}).`);
        }
    }

    public async setBtpGlobalAccount(subdomain: string): Promise<void> {
        this.checkLoggedIn();
        this._btpRequestHeaders['x-cpcli-subdomain'] = subdomain;
    }

    public async getBtpSubAccounts(): Promise<any[]> {
        this.checkLoggedIn();
        const globalAccount = this._btpRequestHeaders['x-cpcli-subdomain'];
        if (!globalAccount) {
            throw new Error(`BTP global account not selected.`);
        }
        try {
            return (await axios.post(`${BTP_CLI_SERVER}/command/${BTP_CLI_VERSION}/accounts/subaccount?list`, {
                "paramValues": {
                    "authorized": "false",
                    "globalAccount": globalAccount
                }
            }, {
                headers: this._btpRequestHeaders
            })).data?.value || [];
        } catch (e) {
            throw new Error(`Couldn't read BTP subaccounts of global account "${globalAccount}" (${getErrorReason(e)}).`);
        }
    }

    private checkLoggedIn() {
        if (!this._btpRequestHeaders) {
            throw new Error(`Not logged into BTP.`);
        }
    }

}
