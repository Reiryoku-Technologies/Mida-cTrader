import {
    MidaPlugin,
    MidaPluginActions,
    MidaPluginParameters,
} from "@reiryoku/mida";
import { CTraderPluginInstallOptions } from "#CTraderPluginInstallOptions";

export class CTraderPlugin extends MidaPlugin {
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

    override install (actions: MidaPluginActions, options?: CTraderPluginInstallOptions): void {
        // Silence is golden.
    }
}
