import { type IConnect, type PluginRegistrar } from "trm-commons";
import { BTPConnect } from "./BTPConnect";
import type * as TrmCore from 'trm-core';
import type * as TrmCommons from 'trm-commons';
import { setCore } from './core';
import { setCommons } from "./commons";
import { setGlobalLogLevel } from "@sap-cloud-sdk/util";

export default (on: PluginRegistrar["on"]) => {
    // sap cloud sdk logs to console by default, keep the client output clean (errors are rethrown by the plugin)
    setGlobalLogLevel('error');
    on("client", "loadCore", (opts: { core: typeof TrmCore }) => {
        setCore(opts.core);
    });
    on("client", "loadCommons", (opts: { commons: typeof TrmCommons }) => {
        setCommons(opts.commons);
    });
    on("client", "onContextLoadConnections", (connections: IConnect[]) => {
        connections.push(new BTPConnect());
        return connections;
    });
};