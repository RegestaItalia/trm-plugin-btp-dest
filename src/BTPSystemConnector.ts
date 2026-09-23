import type { Login, RESTConnection } from 'trm-core';
import { getCore } from './core';
import { CfClient } from './CfClient';
import type { CF } from './CF';

const Core = getCore().RESTSystemConnector;

export interface BtpConnection extends RESTConnection {
    vcapServices: string,
    guid: string,
    btpDestinationName: string,
    cfRegion: string,
    cfRefreshToken: string
}

export class BtpSystemConnector extends Core {

    constructor(private _btpConnection: BtpConnection, private _destinationLogin: Login, cf?: CF) {
        super({..._btpConnection, ...{ endpoint: '' }} as RESTConnection, _destinationLogin, false);
        const connData = this.getConnectionData();
        this._client = new CfClient(connData.endpoint, connData.rfcdest!, this._destinationLogin, this.getLangu(true), this._btpConnection, cf);
    }

    public async closeConnection(): Promise<void> {
        await (this._client as CfClient).closeTunnel();
    }
}