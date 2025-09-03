import { type IConnect, type PluginRegistrar } from "trm-commons";
import { BTPConnect } from "./BTPConnect";
import type * as TrmCore from 'trm-core';
import type * as TrmCommons from 'trm-commons';
import { setCore } from './core';
import { setCommons } from "./commons";

export default (on: PluginRegistrar["on"]) => {
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