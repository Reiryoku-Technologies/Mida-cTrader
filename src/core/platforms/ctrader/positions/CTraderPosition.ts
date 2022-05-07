import {
    GenericObject,
    MidaOrder,
    MidaOrderDirection,
    MidaPosition,
    MidaPositionDirection,
    MidaPositionStatus,
    MidaProtection,
    MidaProtectionChange,
    MidaUtilities,
} from "@reiryoku/mida";
import { CTraderPositionParameters } from "#platforms/ctrader/positions/CTraderPositionParameters";
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { CTraderTradingAccount } from "#platforms/ctrader/CTraderTradingAccount";

export class CTraderPosition extends MidaPosition {
    readonly #connection: CTraderConnection;
    readonly #updateEventQueue: GenericObject[];
    #updateEventIsLocked: boolean;
    #updateEventUuid?: string;
    readonly #protectionChangePendingRequests: Map<string, [ MidaProtection, Function, ]>;

    public constructor ({
        id,
        symbol,
        tradingAccount,
        volume,
        direction,
        protection,
        connection,
    }: CTraderPositionParameters) {
        super({
            id,
            symbol,
            volume,
            direction,
            tradingAccount,
            protection,
        });

        this.#connection = connection;
        this.#updateEventQueue = [];
        this.#updateEventIsLocked = false;
        this.#updateEventUuid = undefined;
        this.#protectionChangePendingRequests = new Map();

        this.#configureListeners();
    }

    get #cTraderTradingAccount (): CTraderTradingAccount {
        return this.tradingAccount as CTraderTradingAccount;
    }

    get #brokerAccountId (): string {
        return this.#cTraderTradingAccount.brokerAccountId;
    }

    public override async getUsedMargin (): Promise<number> {
        if (this.status === MidaPositionStatus.CLOSED) {
            return 0;
        }

        const plainPosition: GenericObject = this.#cTraderTradingAccount.getPlainPositionById(this.id) as GenericObject;

        return Number(plainPosition.usedMargin) / 100;
    }

    public override async addVolume (volume: number): Promise<MidaOrder> {
        return this.tradingAccount.placeOrder({
            positionId: this.id,
            direction: this.direction === MidaPositionDirection.LONG ? MidaOrderDirection.BUY : MidaOrderDirection.SELL,
            volume: volume,
        });
    }

    public override async subtractVolume (volume: number): Promise<MidaOrder> {
        return this.tradingAccount.placeOrder({
            positionId: this.id,
            direction: this.direction === MidaPositionDirection.LONG ? MidaOrderDirection.SELL : MidaOrderDirection.BUY,
            volume: volume,
        });
    }

    public override async getUnrealizedSwap (): Promise<number> {
        if (this.status === MidaPositionStatus.CLOSED) {
            return 0;
        }

        const plainPosition: GenericObject = this.#cTraderTradingAccount.getPlainPositionById(this.id) as GenericObject;

        return Number(plainPosition.swap) / 100;
    }

    public override async getUnrealizedCommission (): Promise<number> {
        if (this.status === MidaPositionStatus.CLOSED) {
            return 0;
        }

        const plainPosition: GenericObject = this.#cTraderTradingAccount.getPlainPositionById(this.id) as GenericObject;

        return Number(plainPosition.commission) / 100 * 2;
    }

    public override async getUnrealizedGrossProfit (): Promise<number> {
        if (this.status === MidaPositionStatus.CLOSED) {
            return 0;
        }

        const plainPosition: GenericObject = this.#cTraderTradingAccount.getPlainPositionById(this.id) as GenericObject;

        return this.#cTraderTradingAccount.getPlainPositionGrossProfit(plainPosition);
    }

    public override async changeProtection (protection: MidaProtection): Promise<MidaProtectionChange> {
        const requestDescriptor: GenericObject = {
            positionId: this.id,
            stopLoss: this.stopLoss,
            takeProfit: this.takeProfit,
            trailingStopLoss: this.trailingStopLoss,
        };

        if ("stopLoss" in protection) {
            requestDescriptor.stopLoss = protection.stopLoss;
        }

        if ("takeProfit" in protection) {
            requestDescriptor.takeProfit = protection.takeProfit;
        }

        if ("trailingStopLoss" in protection) {
            requestDescriptor.trailingStopLoss = protection.trailingStopLoss;
        }

        const uuid: string = MidaUtilities.uuid();
        const protectionChangePromise: Promise<MidaProtectionChange> = new Promise((resolver: Function) => {
            this.#protectionChangePendingRequests.set(uuid, [ protection, resolver, ]);
        });

        this.#sendCommand("ProtoOAAmendPositionSLTPReq", requestDescriptor, uuid);

        return protectionChangePromise;
    }

    // eslint-disable-next-line max-lines-per-function
    async #onUpdate (descriptor: GenericObject): Promise<void> {

    }

    #configureListeners (): void {
        this.#updateEventUuid = this.#connection.on("ProtoOAExecutionEvent", ({ descriptor, }): void => {
            if (descriptor.ctidTraderAccountId.toString() === this.#brokerAccountId) {
                this.#onUpdate(descriptor); // Not using await is intended
            }
        });
    }

    #removeEventsListeners (): void {
        if (this.#updateEventUuid) {
            this.#connection.removeEventListener(this.#updateEventUuid);

            this.#updateEventUuid = undefined;
        }
    }

    async #sendCommand (payloadType: string, parameters?: GenericObject, messageId?: string): Promise<GenericObject> {
        return this.#connection.sendCommand(payloadType, {
            ctidTraderAccountId: this.#brokerAccountId,
            ...parameters ?? {},
        }, messageId);
    }
}
