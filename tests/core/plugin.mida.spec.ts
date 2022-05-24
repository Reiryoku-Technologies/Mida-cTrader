import { MidaPlugin, } from "@reiryoku/mida";

describe("plugin.mida.ts", (): void => {
    describe("exports", (): void => {
        it("a MidaPlugin instance as default", (): void => {
            expect(require("!/plugin.mida").default).toBeInstanceOf(MidaPlugin);
        });
    });
});
