/**
 * Identifiers for the entities that reference each other across `core`.
 *
 * They are branded strings: a `NodeId` cannot be passed where an `EdgeId` is expected, which is
 * the cheapest guard against the mixups graph code invites. The brand is a type-only symbol, so
 * an id is a plain string at runtime and JSON round-trips it unchanged (architecture rule 3).
 */

declare const idBrand: unique symbol;

type Branded<Tag extends string> = string & { readonly [idBrand]: Tag };

export type NodeId = Branded<"NodeId">;
export type EdgeId = Branded<"EdgeId">;
export type ReportId = Branded<"ReportId">;

/** The only sanctioned way to produce a `NodeId`; the brand is unforgeable otherwise. */
export const makeNodeId = (value: string): NodeId => value as NodeId;

export const makeEdgeId = (value: string): EdgeId => value as EdgeId;

export const makeReportId = (value: string): ReportId => value as ReportId;
