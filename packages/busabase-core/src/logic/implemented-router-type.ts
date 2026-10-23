import type { AnyContractRouter, ContractProcedure } from "@orpc/contract";
import type { Context, Procedure } from "@orpc/server";

/**
 * The type of a router that implements `T` procedure-for-procedure, with no
 * lazy branches. Used to annotate the big implemented routers explicitly: their
 * inferred types sit at TypeScript's declaration-serialization limit (TS7056),
 * and an annotation lets declaration emit refer to the contract instead of
 * spelling out every procedure's expanded schema. oRPC's own `Router<T>` would
 * also work for emit, but it widens every sub-router to `Lazyable<…>`, which the
 * hosts that mount sub-routers (e.g. Busabase Cloud's OpenAPI surface) reject.
 */
export type ImplementedContractRouter<
  T extends AnyContractRouter,
  TContext extends Context = Context,
> = T extends ContractProcedure<infer UInput, infer UOutput, infer UErrors, infer UMeta>
  ? Procedure<TContext, TContext, UInput, UOutput, UErrors, UMeta>
  : {
      [K in keyof T]: T[K] extends AnyContractRouter
        ? ImplementedContractRouter<T[K], TContext>
        : never;
    };
