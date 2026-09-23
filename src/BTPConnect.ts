import type { IConnect } from "trm-commons";
import type { ISystemConnector } from "trm-core";
import { BTP } from "./BTP";
import { CF } from "./CF";
import { getCommons } from "./commons";
import { promptLogin, type LoginData } from "./promptLogin";
import { CfRefreshTokenExpiredError } from "./errors";

const SSH_APP_NAME = 'trm-ssh';

// arguments accepted from the client (e.g. trm --connection-type BTP --connection-args '{...}')
export type BTPConnectArgs = {
    btpEmail?: string,
    btpPassword?: string,
    btpPassport?: string,
    btpPassportPassphrase?: string,
    btpGlobalAccount?: string,
    btpSubaccount?: string,
    cfRegion?: string,
    btpDestination?: string,
    forwardRfcDest?: string
};

// arguments that can also be set with an environment variable (connection arguments win)
const ENV_ARGS: { [name in keyof BTPConnectArgs]?: string } = {
    btpPassport: 'TRM_SAP_PASSPORT',
    btpPassportPassphrase: 'TRM_SAP_PASSPORT_PASSPHRASE'
};

export class BTPConnect implements IConnect {

    name = 'BTP';
    description = 'BTP (via Cloud Foundry)';
    loginData = false;
    connectionArgs = [
        { name: 'btpEmail', description: 'BTP user email.' },
        { name: 'btpPassword', description: 'BTP user password.', secret: true },
        { name: 'btpPassport', description: `SAP Passport (.pfx) file path or base64 content, replaces email and password (env ${ENV_ARGS.btpPassport}).`, secret: true },
        { name: 'btpPassportPassphrase', description: `SAP Passport passphrase (env ${ENV_ARGS.btpPassportPassphrase}).`, secret: true },
        { name: 'btpGlobalAccount', description: 'BTP global account (subdomain or display name).' },
        { name: 'btpSubaccount', description: 'BTP subaccount (subdomain, id, technical name or display name).' },
        { name: 'cfRegion', description: 'Cloud Foundry region (e.g. eu10), skips global account and subaccount selection.' },
        { name: 'btpDestination', description: 'Name of the BTP destination (proxy type OnPremise).' },
        { name: 'forwardRfcDest', description: 'RFC destination (on the destination system) trm-rest forwards calls to, NONE for no forward.' }
    ];

    private _btp!: BTP;
    private _cf?: CF;

    private _vcapServices: any;
    private _destination: any = {};
    private _appGuid!: string;
    private _cfRegion!: string;
    private _cfRefreshToken!: string;
    private _rfcdest: string = 'NONE';

    private getArgs(force: boolean, commandArgs?: any): BTPConnectArgs {
        // force: ask everything again
        if (force) {
            return {};
        }
        const args: BTPConnectArgs = {};
        this.connectionArgs.forEach(o => {
            const envName = ENV_ARGS[o.name as keyof BTPConnectArgs];
            const value = commandArgs?.[o.name] ?? (envName ? process.env[envName] : undefined);
            if (typeof value === 'string' || typeof value === 'number') {
                if (`${value}`.trim() === '') return;
                args[o.name as keyof BTPConnectArgs] = `${value}`.trim();
            }
        });
        return args;
    }

    private async pickGlobalAccount(args: BTPConnectArgs): Promise<string> {
        const Commons = getCommons();
        Commons.Logger.loading(`Reading BTP global accounts...`);
        const btpGlobalAccounts = await this._btp.getBtpGlobalAccounts();
        if (btpGlobalAccounts.length === 0) {
            throw new Error(`No BTP global account available for this user.`);
        }
        if (args.btpGlobalAccount) {
            const match = btpGlobalAccounts.find(o => o.subdomain === args.btpGlobalAccount || o.displayName === args.btpGlobalAccount);
            if (!match) {
                throw new Error(`BTP global account "${args.btpGlobalAccount}" not found. Available: ${btpGlobalAccounts.map(o => o.subdomain).join(', ')}.`);
            }
            return match.subdomain;
        }
        return (await Commons.Inquirer.prompt({
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
    }

    private async pickSubaccount(args: BTPConnectArgs, btpGlobalAccount: string): Promise<any> {
        const Commons = getCommons();
        Commons.Logger.loading(`Reading BTP subaccounts...`);
        const btpSubAccounts = await this._btp.getBtpSubAccounts();
        if (btpSubAccounts.length === 0) {
            throw new Error(`No subaccount available in BTP global account "${btpGlobalAccount}".`);
        }
        if (args.btpSubaccount) {
            const key = args.btpSubaccount;
            const match = btpSubAccounts.find(o => [o.subdomain, o.guid, o.technicalName, o.displayName].includes(key));
            if (!match) {
                throw new Error(`BTP subaccount "${key}" not found in global account "${btpGlobalAccount}". Available: ${btpSubAccounts.map(o => o.subdomain || o.technicalName).join(', ')}.`);
            }
            return match;
        }
        return (await Commons.Inquirer.prompt({
            name: 'subaccount',
            message: 'Choose subaccount',
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
    }

    private async pickRegion(args: BTPConnectArgs, btpLoginData: LoginData): Promise<string> {
        if (args.cfRegion) {
            return args.cfRegion;
        }
        this._btp = new BTP(btpLoginData);
        getCommons().Logger.loading('passport' in btpLoginData ? `Logging into BTP with SAP Passport...` : `Logging into BTP...`);
        await this._btp.login();

        const btpGlobalAccount = await this.pickGlobalAccount(args);
        await this._btp.setBtpGlobalAccount(btpGlobalAccount);

        const btpSubAccount = await this.pickSubaccount(args, btpGlobalAccount);
        if (!btpSubAccount.region) {
            throw new Error(`Couldn't determine the region of subaccount "${btpSubAccount.displayName || btpSubAccount.technicalName}".`);
        }
        return btpSubAccount.region;
    }

    private async pickDestination(cf: CF, args: BTPConnectArgs): Promise<any> {
        const Commons = getCommons();
        Commons.Logger.loading(`Reading destinations...`);
        const destinations = (await cf.getDestinations(this._vcapServices.destination[0])).filter(o => o.ProxyType === 'OnPremise');
        if (args.btpDestination) {
            const match = destinations.find(o => o.Name === args.btpDestination);
            if (!match) {
                throw new Error(`Destination "${args.btpDestination}" with proxy type "OnPremise" not found in the subaccount.`);
            }
            return match;
        }
        if (destinations.length === 0) {
            throw new Error(`No destination with proxy type "OnPremise" found in the subaccount.`);
        }
        return (await Commons.Inquirer.prompt({
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

    public async onConnectionData(force: boolean, commandArgs?: any): Promise<void> {
        const Commons = getCommons();
        const args = this.getArgs(force, commandArgs);
        const btpLoginData = await this.promptLogin(args);

        this._cfRegion = await this.pickRegion(args, btpLoginData);
        this._cf = BTPConnect.cfFromLogin(btpLoginData, this._cfRegion);
        Commons.Logger.loading(`Logging into Cloud Foundry (${this._cfRegion})...`);
        await this._cf.login();
        this._cfRefreshToken = this._cf.getRefreshToken();

        Commons.Logger.loading(`Searching ${SSH_APP_NAME} app...`);
        const apps = await this._cf.getApps(SSH_APP_NAME);
        const sshApp = apps.length > 0 ? apps[0] : undefined;
        if (!sshApp) {
            throw new Error(`App "${SSH_APP_NAME}" not found in Cloud Foundry region ${this._cfRegion}. Deploy it first (see plugin README).`);
        }
        if (apps.length > 1) {
            Commons.Logger.warning(`Found ${apps.length} "${SSH_APP_NAME}" apps, using the first one.`);
        }
        if (sshApp.state && sshApp.state !== 'STARTED') {
            throw new Error(`App "${SSH_APP_NAME}" is not running (state: ${sshApp.state}). Start it and try again.`);
        }
        this._appGuid = sshApp.guid;
        const sshEnabled = await this._cf.isSshEnabled(this._appGuid);
        if (!sshEnabled.enabled) {
            if (sshEnabled.reason) {
                Commons.Logger.warning(`${SSH_APP_NAME}: ${sshEnabled.reason}`);
            }
            throw new Error(`SSH is not enabled on app "${SSH_APP_NAME}". Run "cf enable-ssh ${SSH_APP_NAME}" and "cf restart ${SSH_APP_NAME}", then try again.`);
        }

        Commons.Logger.loading(`Reading ${SSH_APP_NAME} environment...`);
        const appEnv = await this._cf.getAppEnv(this._appGuid);
        this._vcapServices = appEnv?.system_env_json?.['VCAP_SERVICES'];
        if (!this._vcapServices?.destination?.[0]) {
            throw new Error(`Destination service binding not found on app "${SSH_APP_NAME}". Bind a Destination service instance to it and restage.`);
        }
        if (!this._vcapServices?.connectivity?.[0]) {
            throw new Error(`Connectivity service binding not found on app "${SSH_APP_NAME}". Bind a Connectivity service instance to it and restage.`);
        }

        this._destination = await this.pickDestination(this._cf, args);
        this._rfcdest = await this.pickForwardRfcDest(force, commandArgs);
    }

    // same rules as the REST connection: provided (string) = use it, otherwise prompt (default saved rfcdest or NONE)
    private async pickForwardRfcDest(force: boolean, commandArgs?: any): Promise<string> {
        const forwardRfcDest = commandArgs?.forwardRfcDest;
        const preset: string = typeof forwardRfcDest === 'string' && forwardRfcDest.trim() ? forwardRfcDest : (this._rfcdest || 'NONE');
        var value = preset;
        if (!(typeof forwardRfcDest === 'string' && forwardRfcDest.trim()) || force) {
            value = (await getCommons().Inquirer.prompt({
                type: `input`,
                name: `rfcdest`,
                message: `Forward RFC Destination`,
                default: preset
            })).rfcdest || preset;
        }
        return value.trim().toUpperCase() || 'NONE';
    }

    public async onAfterLoginData(force: boolean, commandArgs?: any): Promise<void> {
        const Commons = getCommons();
        if (!this._cf) {
            if (!this._cfRegion || !this._cfRefreshToken) {
                throw new Error(`BTP connection data is incomplete, create the connection again.`);
            }
            this._cf = CF.fromRefreshToken(this._cfRegion, this._cfRefreshToken);
        }
        try {
            await this._cf.login();
        } catch (e) {
            if (!(e instanceof CfRefreshTokenExpiredError)) {
                throw e;
            }
            const args = this.getArgs(force, commandArgs);
            if (!args.btpPassport && (!args.btpEmail || !args.btpPassword)) {
                Commons.Logger.warning(`Cloud Foundry session expired, log into BTP again.`);
            }
            this._cf = BTPConnect.cfFromLogin(await this.promptLogin(args), this._cfRegion);
            await this._cf.login();
        }
        this._cfRefreshToken = this._cf.getRefreshToken();
    }

    private promptLogin(args: BTPConnectArgs): Promise<LoginData> {
        return promptLogin({ email: args.btpEmail, password: args.btpPassword, passport: args.btpPassport, passportPassphrase: args.btpPassportPassphrase });
    }

    private static cfFromLogin(loginData: LoginData, region: string): CF {
        return 'passport' in loginData ? CF.fromPassport(loginData.passport, region) : CF.fromLogin(loginData.email, loginData.password, region);
    }

    public getSystemConnector(): ISystemConnector {
        // loaded lazily: it extends trm-core classes, that must be resolved after the loadCore hook
        const { BtpSystemConnector } = require("./BTPSystemConnector") as typeof import("./BTPSystemConnector");
        if (!this._cf) {
            if (!this._cfRegion || !this._cfRefreshToken) {
                throw new Error(`BTP connection data is incomplete, create the connection again.`);
            }
            this._cf = CF.fromRefreshToken(this._cfRegion, this._cfRefreshToken);
        }
        // the connector shares the same Cloud Foundry session, so getData() always returns the latest refresh token
        return new BtpSystemConnector(this.getData(), { ...this.getData(), ...{ client: '000', user: this._destination.Name, passwd: 'INITIAL', lang: 'EN' } }, this._cf);
    }

    public setData(data: any): void {
        try {
            this._vcapServices = data.vcapServices ? JSON.parse(data.vcapServices) : undefined;
        } catch (e) {
            throw new Error(`Saved BTP connection data is not valid, create the connection again.`);
        }
        this._appGuid = data.guid;
        this._destination.Name = data.btpDestinationName;
        this._cfRegion = data.cfRegion;
        this._cfRefreshToken = data.cfRefreshToken;
        this._cf = undefined; // new data, new session
        this._rfcdest = data.rfcdest || 'NONE';
    }

    public getData(): any {
        return {
            vcapServices: JSON.stringify(this._vcapServices),
            guid: this._appGuid,
            btpDestinationName: this._destination.Name,
            cfRegion: this._cfRegion,
            cfRefreshToken: this._cf?.peekRefreshToken() || this._cfRefreshToken,
            rfcdest: this._rfcdest
        };
    }

    public logData(): void {
        const Commons = getCommons();
        if (this._destination.Name) {
            Commons.Logger.info(`Destination: ${this._destination.Name}`);
        } else {
            Commons.Logger.warning(`Destination: Unknown`);
        }
        if (this._cfRegion) {
            Commons.Logger.info(`Cloud Foundry region: ${this._cfRegion}`);
        } else {
            Commons.Logger.warning(`Cloud Foundry region: Unknown`);
        }
        if (this._rfcdest && this._rfcdest !== 'NONE') {
            Commons.Logger.info(`RFC Forward: ${this._rfcdest}`);
        }
    };

}
