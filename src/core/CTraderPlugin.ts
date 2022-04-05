import {
    MidaPlugin,
    MidaPluginActions,
} from "@reiryoku/mida";
import { CTraderBroker } from "#brokers/ctrader/CTraderBroker";

export const ORDER_SIGNATURE: string = "Mida/cTrader";

export class CTraderPlugin extends MidaPlugin {
    public constructor () {
        super({
            id: "d925e9fe-4352-4391-9a85-f21b2ba6b6d6",
            name: "cTrader",
            description: "A Mida plugin for using cTrader accounts",
            version: "2.0.1",
        });
    }

    public override install (actions: MidaPluginActions): void {
        actions.addBroker("cTrader", CTraderPlugin.#broker);
    }

    /* *** *** *** Reiryoku Technologies *** *** *** */

    static readonly #broker: CTraderBroker = new CTraderBroker();

    public static get broker (): CTraderBroker {
        return CTraderPlugin.#broker;
    }
}
