import axios from "axios";
import { getCommons } from "./commons";

const Commons = getCommons();

export class BTP {

    private _btpRequestHeaders: any;

    constructor(private _username: string, private _password: string) { }

    public async login() {
        try {
            const btpLogin = await axios.post("https://cli.btp.cloud.sap/login/v2.90.2", {
                "customIdp": "",
                "userName": this._username,
                "password": this._password,
                "jwt": ""
            });
            this._btpRequestHeaders = {
                'x-cpcli-sessionid': btpLogin.headers['x-cpcli-sessionid'],
                'x-cpcli-format': 'json'
            };
        } catch (e) {
            Commons.Logger.error(e.toString(), true);
            throw new Error(`BTP Login failed.`);
        }
    }

    public async getBtpGlobalAccounts(): Promise<any[]> {
        try {
            return (await axios.post("https://cli.btp.cloud.sap/client/v2.90.2/globalAccountList", undefined, {
                headers: this._btpRequestHeaders
            })).data;
        } catch (e) {
            throw new Error(`BTP Global accounts fetch failed.`);
        }
    }

    public async setBtpGlobalAccount(subdomain: string): Promise<void> {
        if (this._btpRequestHeaders) {
            this._btpRequestHeaders['x-cpcli-subdomain'] = subdomain;
        }
    }

    public async getBtpSubAccounts(): Promise<any[]> {
        try {
            return (await axios.post("https://cli.btp.cloud.sap/command/v2.90.2/accounts/subaccount?list", {
                "paramValues": {
                    "authorized": "false",
                    "globalAccount": this._btpRequestHeaders['x-cpcli-subdomain']
                }
            }, {
                headers: this._btpRequestHeaders
            })).data.value;
        } catch (e) {
            throw new Error(`BTP Sub accounts fetch failed.`);
        }
    }

}