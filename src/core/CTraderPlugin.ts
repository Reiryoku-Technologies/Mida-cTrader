import {
    MidaPlugin,
    MidaPluginActions,
} from "@reiryoku/mida";
import { CTraderPluginOptions } from "!/src/core/CTraderPluginOptions";
import { CTraderBroker } from "#brokers/ctrader/CTraderBroker";

export const ORDER_SIGNATURE: string = "Mida/cTrader";

export class CTraderPlugin extends MidaPlugin {
    public constructor () {
        super({
            name: "cTrader",
            version: "2.0.0",
            description: "A Mida plugin for using cTrader accounts",
        });
    }

    public override install (actions: MidaPluginActions, options: CTraderPluginOptions = {}): void {
        actions.addBroker("cTrader", CTraderPlugin.#broker);
    }

    /* *** *** *** Reiryoku Technologies *** *** *** */

    static readonly #broker: CTraderBroker = new CTraderBroker();

    public static get broker (): CTraderBroker {
        return CTraderPlugin.#broker;
    }
}
