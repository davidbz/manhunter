/**
 * The threshold contour of the belief field (PLAN M6.6): the outline of the region the hunter
 * suspects most, drawn as one line round the top tier rather than as a ring per node.
 *
 * Belief is one cell per node (PLAN M3.6b), so the field is piecewise constant over the district
 * cells PLAN M6.3 derives, and the region at or over a threshold is exactly the union of the cells
 * whose node clears it. Its outline is every cell edge that no other cell in the region shares:
 * two neighbouring Voronoi cells clip each other along the same bisector, so an interior edge
 * appears twice, once in each cell, and the boundary is what is left. No polygon union is needed.
 *
 * The two copies of a shared edge are computed by different clip sequences, so they agree to
 * rounding rather than exactly; they are matched within `SHARED_VERTEX_TOLERANCE`. An edge shorter
 * than that is a clipping artefact (a vertex where four sites are cocircular) and is dropped.
 * Two coincident nodes get the same cell (PLAN M6.3's note), so when both are in the region their
 * edges cancel and that cell draws no outline; that is the degenerate case and it does not throw.
 */

import type { NodeId, Position } from "@manhunter/core";
import type { CellPolygon, DistrictCell } from "./districtcells";

export type ContourSegment = {
  readonly from: Position;
  readonly to: Position;
};

/** Map units. Clipping error is around 1e-10 on a map a few hundred units across. */
const SHARED_VERTEX_TOLERANCE = 1e-6;

type OwnedSegment = {
  readonly owner: NodeId;
  readonly segment: ContourSegment;
};

const near = (first: Position, second: Position): boolean =>
  Math.abs(first.x - second.x) <= SHARED_VERTEX_TOLERANCE &&
  Math.abs(first.y - second.y) <= SHARED_VERTEX_TOLERANCE;

const sameSegment = (first: ContourSegment, second: ContourSegment): boolean =>
  (near(first.from, second.from) && near(first.to, second.to)) ||
  (near(first.from, second.to) && near(first.to, second.from));

/** A polygon's edges, the closing one included, less any too short to have a direction. */
export const polygonEdgesOf = (polygon: CellPolygon): readonly ContourSegment[] =>
  polygon.flatMap((from, index) => {
    const to = polygon[(index + 1) % polygon.length];
    if (to === undefined || near(from, to)) return [];

    return [{ from, to }];
  });

/**
 * The outline of the union of `inside`'s cells: each edge of a cell in the region that no other
 * cell in the region also has. Edges on the plate's own border have no twin and are kept, so a
 * region touching the edge of the map is closed along it.
 */
export const contourOf = (
  cells: readonly DistrictCell[],
  inside: ReadonlySet<NodeId>,
): readonly ContourSegment[] => {
  const owned: readonly OwnedSegment[] = cells
    .filter((cell) => inside.has(cell.nodeId))
    .flatMap((cell) =>
      polygonEdgesOf(cell.polygon).map((segment) => ({ owner: cell.nodeId, segment })),
    );

  return owned
    .filter(
      (edge) =>
        !owned.some(
          (other) => other.owner !== edge.owner && sameSegment(other.segment, edge.segment),
        ),
    )
    .map((edge) => edge.segment);
};
