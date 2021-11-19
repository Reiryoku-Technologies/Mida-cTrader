import {
    MidaPlugin,
    MidaPluginActions,
    MidaPluginParameters,
} from "@reiryoku/mida";
import { CTraderPluginInstallOptions } from "#CTraderPluginInstallOptions";
import { CTraderBroker } from "#brokers/ctrader/CTraderBroker";

export class CTraderPlugin extends MidaPlugin {
    static #broker: CTraderBroker = new CTraderBroker();

    public constructor ({
        id,
        name,
        version,
        description,
    }: MidaPluginParameters) {
        super({
            id,
            name,
            version,
            description,
        });
    }

    public override install (actions: MidaPluginActions, options?: CTraderPluginInstallOptions): void {
        actions.addBroker(CTraderPlugin.#broker);
    }

    public static get broker (): CTraderBroker {
        return CTraderPlugin.#broker;
    }
}
