import { Login, RESTConnection, RESTSystemConnector } from "trm-core";
import { CfClient } from "./CfClient";

export interface BtpConnection extends RESTConnection {
    vcapServices: string,
    guid: string,
    btpDestinationName: string,
    cfRegion: string,
    cfRefreshToken: string
}

export class BtpSystemConnector extends RESTSystemConnector {

    constructor(private _btpConnection: BtpConnection, private _destinationLogin: Login) {
        super({..._btpConnection, ...{ endpoint: '' }} as RESTConnection, _destinationLogin, false);
        const connData = this.getConnectionData();
        this._client = new CfClient(connData.endpoint, connData.rfcdest, this._destinationLogin, this.getLangu(true), this._btpConnection);
    }

    public async closeConnection(): Promise<void> {
        await (this._client as CfClient).closeTunnel();
    }
}