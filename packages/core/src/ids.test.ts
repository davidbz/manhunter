import { describe, expect, it } from "vitest";
import type { EdgeId, NodeId } from "./ids";
import { makeEdgeId, makeNodeId, makeReportId } from "./ids";

// The brand exists only in the type layer, so the guard it provides is a compile-time one. These
// aliases fail the typecheck step rather than the test run if the brands ever become assignable.
type AssertTrue<T extends true> = T;
type NotAssignable<From, To> = From extends To ? false : true;

export type NodeIdIsNotAnEdgeId = AssertTrue<NotAssignable<NodeId, EdgeId>>;
export type PlainStringIsNotANodeId = AssertTrue<NotAssignable<string, NodeId>>;
export type NodeIdIsAString = AssertTrue<NodeId extends string ? true : false>;

describe("id constructors", () => {
  it("keep the string they were given", () => {
    expect(makeNodeId("node-3")).toBe("node-3");
    expect(makeEdgeId("edge-3")).toBe("edge-3");
    expect(makeReportId("report-3")).toBe("report-3");
  });

  it("produce plain strings that JSON round-trips (architecture rule 3)", () => {
    const id = makeNodeId("node-7");
    expect(JSON.parse(JSON.stringify({ id }))).toEqual({ id: "node-7" });
  });
});
