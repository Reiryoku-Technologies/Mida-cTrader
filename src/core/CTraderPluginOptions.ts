import { CTraderApplicationParameters } from "#brokers/ctrader/CTraderApplicationParameters";

export type CTraderPluginOptions = {
    preloadApplication?: CTraderApplicationParameters;
    preloadApplications?: CTraderApplicationParameters[];
};
