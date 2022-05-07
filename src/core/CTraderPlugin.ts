import {
    MidaPlugin,
    MidaPluginActions,
} from "@reiryoku/mida";
import { CTrader } from "#platforms/ctrader/CTrader";

export class CTraderPlugin extends MidaPlugin {
    public constructor () {
        super({
            id: "d925e9fe-4352-4391-9a85-f21b2ba6b6d6",
            name: "cTrader",
            description: "A Mida plugin for using cTrader",
            version: "2.1.0",
        });
    }

    public override install (actions: MidaPluginActions): void {
        actions.addBroker("cTrader", CTraderPlugin.#platform);
    }

    /* *** *** *** Reiryoku Technologies *** *** *** */

    static readonly #platform: CTrader = new CTrader();

    public static get platform (): CTrader {
        return CTraderPlugin.#platform;
    }
}
