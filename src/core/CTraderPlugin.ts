import {
    MidaPlugin,
    MidaPluginActions,
    MidaPluginParameters,
} from "@reiryoku/mida";
import { CTraderPluginOptions } from "#CTraderPluginOptions";
import { CTraderBroker } from "#brokers/ctrader/CTraderBroker";

export class CTraderPlugin extends MidaPlugin {
    public constructor (parameters: MidaPluginParameters) {
        super(parameters);
    }

    public override install (actions: MidaPluginActions, options: CTraderPluginOptions = {}): void {
        actions.addBroker(CTraderPlugin.#broker);
    }

    /* *** *** *** Reiryoku Technologies *** *** *** */

    static readonly #broker: CTraderBroker = new CTraderBroker();

    public static get broker (): CTraderBroker {
        return CTraderPlugin.#broker;
    }
}
