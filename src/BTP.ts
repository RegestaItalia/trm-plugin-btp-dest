import axios from "axios";
import { getCommons } from "./commons";
import { getErrorReason, getHttpStatus } from "./errors";

const BTP_CLI_SERVER = "https://cli.btp.cloud.sap";
const BTP_CLI_VERSION = "v2.90.2";

export class BTP {

    private _btpRequestHeaders: any;

    constructor(private _username: string, private _password: string) { }

    public async login() {
        var sessionId: string | undefined;
        try {
            const btpLogin = await axios.post(`${BTP_CLI_SERVER}/login/${BTP_CLI_VERSION}`, {
                "customIdp": "",
                "userName": this._username,
                "password": this._password,
                "jwt": ""
            });
            sessionId = btpLogin.headers['x-cpcli-sessionid'];
        } catch (e) {
            getCommons().Logger.error(String(e), true);
            const status = getHttpStatus(e);
            if (status === 401 || status === 403) {
                throw new Error(`BTP login failed: invalid email or password.`);
            }
            throw new Error(`BTP login failed (${getErrorReason(e)}).`);
        }
        if (!sessionId) {
            throw new Error(`BTP login failed: no session returned by BTP.`);
        }
        this._btpRequestHeaders = {
            'x-cpcli-sessionid': sessionId,
            'x-cpcli-format': 'json'
        };
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
