import {
    MidaPlugin,
    MidaPluginActions,
} from "@reiryoku/mida";
import { CTrader, } from "#platforms/ctrader/CTrader";

export const pluginId: string = "d925e9fe-4352-4391-9a85-f21b2ba6b6d6";
export const pluginVersion: string = "3.0.0";

export class CTraderPlugin extends MidaPlugin {
    public constructor () {
        super({
            id: pluginId,
            name: "cTrader",
            description: "A Mida plugin for using cTrader",
            version: pluginVersion,
        });
    }

    public override install (actions: MidaPluginActions): void {
        actions.addPlatform("cTrader", CTraderPlugin.#platform);
    }

    /* *** *** *** Reiryoku Technologies *** *** *** */

    static readonly #platform: CTrader = new CTrader();

    public static get platform (): CTrader {
        return CTraderPlugin.#platform;
    }
}
