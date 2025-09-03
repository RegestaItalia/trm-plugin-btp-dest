import type { IConnect } from "trm-commons";
import type { ISystemConnector } from "trm-core";
import { BtpSystemConnector } from "./BTPSystemConnector";
import { BTP } from "./BTP";
import { CF } from "./CF";
import { getCommons } from "./commons";

const Commons = getCommons();

export class BTPConnect implements IConnect {

    name = 'BTP';
    description = 'BTP (via Cloud Foundry)';
    loginData = false;

    private _btp: BTP;
    private _cf: CF;

    private _vcapServices: any;
    private _destination: any = {};
    private _appGuid: string;
    private _cfRegion: string;
    private _cfRefreshToken: string;

    public async onConnectionData(): Promise<void> {
        const btpLoginData = await Commons.Inquirer.prompt([{
            type: `input`,
            name: `email`,
            message: `BTP Login: Email`
        },
        {
            type: `password`,
            name: `password`,
            message: `BTP Login: Password`
        }]);

        this._btp = new BTP(btpLoginData.email, btpLoginData.password);
        Commons.Logger.loading(`Logging into BTP...`);
        await this._btp.login();

        Commons.Logger.loading(`Reading BTP global accounts...`);
        const btpGlobalAccounts = await this._btp.getBtpGlobalAccounts();
        const btpGlobalAccount = (await Commons.Inquirer.prompt({
            name: 'subdomain',
            message: 'Choose global account',
            type: "list",
            choices: btpGlobalAccounts.map(o => {
                if (o.displayName) {
                    return {
                        name: o.description ? `${o.displayName} ${o.description}` : o.displayName,
                        value: o.subdomain
                    }
                } else {
                    return {
                        name: o.subdomain,
                        value: o.subdomain
                    }
                }
            })
        })).subdomain;
        await this._btp.setBtpGlobalAccount(btpGlobalAccount);

        Commons.Logger.loading(`Reading BTP sub accounts...`);
        const btpSubAccounts = await this._btp.getBtpSubAccounts();
        const btpSubAccount = (await Commons.Inquirer.prompt({
            name: 'subaccount',
            message: 'Choose sub account',
            type: "list",
            choices: btpSubAccounts.map(o => {
                if (o.displayName) {
                    return {
                        name: o.description ? `${o.displayName} ${o.description}` : o.displayName,
                        value: o
                    }
                } else {
                    return {
                        name: o.technicalName,
                        value: o
                    }
                }
            })
        })).subaccount;

        this._cfRegion = btpSubAccount.region;
        this._cf = CF.fromLogin(btpLoginData.email, btpLoginData.password, this._cfRegion);
        Commons.Logger.loading(`Logging into Cloud Foundry...`);
        await this._cf.login();
        this._cfRefreshToken = this._cf.getRefreshToken();

        Commons.Logger.loading(`Searching trm-ssh instance...`);
        const apps = await this._cf.getApps('trm-ssh');
        const sshApp = apps.length > 0 ? apps[0] : undefined;
        if (!sshApp) {
            throw new Error(`App "trm-ssh" not found.`);
        }
        this._appGuid = sshApp.guid;
        const sshEnabled = await this._cf.isSshEnabled(this._appGuid);
        if (!sshEnabled.enabled) {
            if (sshEnabled.reason) {
                Commons.Logger.warning(`trm-ssh: ${sshEnabled.reason}`);
            }
            Commons.Logger.error(`Ssh is not enabled on app "trm-ssh".`);
            throw new Error(`Enable ssh and restart on app "trm-ssh".`);
        }

        try {
            Commons.Logger.loading(`trm-ssh running, reading data...`);
            const appEnv = await this._cf.getAppEnv(this._appGuid);
            this._vcapServices = appEnv.system_env_json['VCAP_SERVICES'];
            if (!this._vcapServices.destination[0]) {
                throw new Error();
            }
        } catch (e) {
            throw new Error(`Couldn't read trm-ssh environment`);
        }

        Commons.Logger.loading(`Reading destinations...`);
        const destinations = (await this._cf.getDestinations(this._vcapServices.destination[0])).filter(o => o.ProxyType === 'OnPremise');
        this._destination = (await Commons.Inquirer.prompt({
            message: `Choose destination`,
            name: 'destination',
            type: "list",
            choices: destinations.map(o => {
                if (o.Name) {
                    return {
                        name: o.Description ? `${o.Name} ${o.Description}` : o.Name,
                        value: o
                    }
                } else {
                    return {
                        name: o.URL,
                        value: o
                    }
                }
            })
        })).destination;
    }

    public getSystemConnector(): ISystemConnector {
        return new BtpSystemConnector(this.getData(), { ...this.getData(), ...{ client: '100', user: 'destination user', passwd: 'destination password', lang: 'EN' } });
    }

    public setData(data: any): void {
        this._vcapServices = JSON.parse(data.vcapServices);
        this._appGuid = data.guid;
        this._destination.Name = data.btpDestinationName;
        this._cfRegion = data.cfRegion;
        this._cfRefreshToken = data.cfRefreshToken;
    }

    public getData(): any {
        return {
            vcapServices: JSON.stringify(this._vcapServices),
            guid: this._appGuid,
            btpDestinationName: this._destination.Name,
            cfRegion: this._cfRegion,
            cfRefreshToken: this._cfRefreshToken
        };
    }

}