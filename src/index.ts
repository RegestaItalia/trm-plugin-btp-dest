import { type IConnect, type PluginRegistrar } from "trm-commons";
import { BTPConnect } from "./BTPConnect";
import type * as TrmCore from 'trm-core';
import { setCore } from './core';

export default (on: PluginRegistrar["on"]) => {
    on("client", "loadCore", (opts: { core: typeof TrmCore }) => {
        setCore(opts.core);
    });
    on("client", "onContextLoadConnections", (connections: IConnect[]) => {
        connections.push(new BTPConnect());
        return connections;
    });
};