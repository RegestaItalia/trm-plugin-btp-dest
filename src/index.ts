import { ILogger, Inquirer, Logger, type IConnect, type IInquirer, type PluginRegistrar } from "trm-commons";
import { BTPConnect } from "./BTPConnect";
import { ISystemConnector, SystemConnector } from "trm-core";

export default (on: PluginRegistrar["on"]) => {
    on("client", "onContextLoadConnections", (connections: IConnect[]) => {
        connections.push(new BTPConnect());
        return connections;
    });
    on("client", "onInitializeInquirer", (inquirer: IInquirer) => {
        Inquirer.inquirer = inquirer;
    });
    on("client", "onInitializeLogger", (logger: ILogger) => {
        Logger.logger = logger;
    });
    on("client", "onInitializeSystemConnector", (systemConnector: ISystemConnector) => {
        SystemConnector.systemConnector = systemConnector;
    });
};
