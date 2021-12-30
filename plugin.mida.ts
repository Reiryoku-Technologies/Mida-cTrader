import { CTraderPlugin } from "!/src/core/CTraderPlugin";

export default new CTraderPlugin({
    id: "mida-ctrader",
    name: "cTrader",
    version: require("../package.json").version,
    description: "A Mida plugin to operate with cTrader.",
});
