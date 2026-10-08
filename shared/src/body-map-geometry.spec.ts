import { BODY_MAP_VIEWS, regionsForZone } from "./body-map-geometry.ts";
import type { BodyMapRegion, BodyMapView } from "./body-map-geometry.ts";
import { BODY_ZONES } from "./body-zone.ts";
import type { BodyZone } from "./body-zone.ts";

interface Point {
  x: number;
  y: number;
}

const PATH_PATTERN = /^M[\d.\s]+(L[\d.\s]+)+Z$/;

function viewById(id: string): BodyMapView {
  const view = BODY_MAP_VIEWS.find((candidate) => candidate.id === id);

  if (view == null) {
    throw new Error(`missing view ${id}`);
  }

  return view;
}

function allRegions(): BodyMapRegion[] {
  return BODY_MAP_VIEWS.flatMap((view) => view.regions);
}

function parsePoints(pathData: string): Point[] {
  const numbers = (pathData.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  const points: Point[] = [];

  for (let i = 0; i < numbers.length; i += 2) {
    points.push({ x: numbers[i], y: numbers[i + 1] });
  }

  return points;
}

function bounds(pathData: string): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const points = parsePoints(pathData);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function centreX(region: BodyMapRegion): number {
  const points = parsePoints(region.pathData);

  return points.reduce((sum, point) => sum + point.x, 0) / points.length;
}

function contains(polygon: Point[], probe: Point): boolean {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const crosses =
      polygon[i].y > probe.y !== polygon[j].y > probe.y &&
      probe.x <
        ((polygon[j].x - polygon[i].x) * (probe.y - polygon[i].y)) /
          (polygon[j].y - polygon[i].y) +
          polygon[i].x;

    if (crosses) {
      inside = !inside;
    }
  }

  return inside;
}

function zonesInView(view: BodyMapView): Set<BodyZone> {
  return new Set(view.regions.map((region) => region.zone));
}

describe("BODY_MAP_VIEWS", () => {
  it("has a front and a back view", () => {
    expect(BODY_MAP_VIEWS.map((view) => view.id)).toEqual(["front", "back"]);
  });

  it("has thirteen regions in total", () => {
    expect(allRegions()).toHaveLength(13);
  });

  it("has six front regions and seven back regions", () => {
    expect(viewById("front").regions).toHaveLength(6);
    expect(viewById("back").regions).toHaveLength(7);
  });

  it("has unique region ids", () => {
    const ids = allRegions().map((region) => region.id);

    expect(new Set(ids).size).toBe(13);
  });

  it("covers every zone with at least one region", () => {
    const covered = new Set(allRegions().map((region) => region.zone));

    expect([...covered].sort()).toEqual([...BODY_ZONES].sort());
  });

  it("has simple closed path data for every silhouette and region", () => {
    for (const view of BODY_MAP_VIEWS) {
      expect(view.silhouettePath.length).toBeGreaterThan(0);

      for (const region of view.regions) {
        expect(region.pathData).toMatch(PATH_PATTERN);
      }
    }
  });

  describe("when checking which view holds each zone", () => {
    it("shows pecs only on the front", () => {
      expect(zonesInView(viewById("front"))).toContain("LEFT_PEC");
      expect(zonesInView(viewById("front"))).toContain("RIGHT_PEC");
      expect(zonesInView(viewById("back"))).not.toContain("LEFT_PEC");
      expect(zonesInView(viewById("back"))).not.toContain("RIGHT_PEC");
    });

    it("shows back zones and glutes only on the back", () => {
      for (const zone of ["UPPER_BACK", "LOWER_BACK", "ASS"] as const) {
        expect(zonesInView(viewById("back"))).toContain(zone);
        expect(zonesInView(viewById("front"))).not.toContain(zone);
      }
    });

    it("shows arms and thighs on both views", () => {
      for (const zone of [
        "LEFT_ARM",
        "RIGHT_ARM",
        "LEFT_THIGH",
        "RIGHT_THIGH",
      ] as const) {
        expect(zonesInView(viewById("front"))).toContain(zone);
        expect(zonesInView(viewById("back"))).toContain(zone);
      }
    });
  });

  describe("when checking anatomical left and right", () => {
    it("places LEFT regions on the viewer right of the front view", () => {
      const front = viewById("front").regions;

      for (const suffix of ["PEC", "ARM", "THIGH"]) {
        const left = front.find((region) => region.zone === `LEFT_${suffix}`);
        const right = front.find((region) => region.zone === `RIGHT_${suffix}`);

        expect(centreX(left!)).toBeGreaterThan(centreX(right!));
      }
    });

    it("places LEFT regions on the viewer left of the back view", () => {
      const back = viewById("back").regions;

      for (const suffix of ["ARM", "THIGH"]) {
        const left = back.find((region) => region.zone === `LEFT_${suffix}`);
        const right = back.find((region) => region.zone === `RIGHT_${suffix}`);

        expect(centreX(left!)).toBeLessThan(centreX(right!));
      }
    });
  });

  describe("when sampling points across each view", () => {
    it("never places a point inside two regions", () => {
      for (const view of BODY_MAP_VIEWS) {
        const polygons = view.regions.map((region) =>
          parsePoints(region.pathData),
        );

        for (let column = 0; column <= 200; column += 2) {
          for (let row = 0; row <= 480; row += 2) {
            const hits = polygons.filter((polygon) =>
              contains(polygon, { x: column, y: row }),
            );

            expect(hits.length).toBeLessThanOrEqual(1);
          }
        }
      }
    });
  });
});

describe("region anchors", () => {
  it("places every anchor inside its own region", () => {
    for (const region of allRegions()) {
      expect(contains(parsePoints(region.pathData), region.anchor)).toBe(true);
    }
  });
});

describe("region hit areas", () => {
  it("has simple closed path data for every hit area", () => {
    for (const region of allRegions()) {
      if (region.hitPathData != null) {
        expect(region.hitPathData).toMatch(PATH_PATTERN);
      }
    }
  });

  it("wraps the visible shape of every region that has one", () => {
    for (const region of allRegions()) {
      if (region.hitPathData != null) {
        const hit = bounds(region.hitPathData);
        const shape = bounds(region.pathData);

        expect(hit.minX).toBeLessThanOrEqual(shape.minX);
        expect(hit.maxX).toBeGreaterThanOrEqual(shape.maxX);
        expect(hit.minY).toBeLessThanOrEqual(shape.minY);
        expect(hit.maxY).toBeGreaterThanOrEqual(shape.maxY);
      }
    }
  });

  it("is at least 37 units wide, about 40px at 375px, for every region that has one", () => {
    for (const region of allRegions()) {
      if (region.hitPathData != null) {
        const hit = bounds(region.hitPathData);

        expect(hit.maxX - hit.minX).toBeGreaterThanOrEqual(37);
      }
    }
  });

  it("never overlaps another hit area in the same view", () => {
    for (const view of BODY_MAP_VIEWS) {
      const polygons = view.regions.map((region) =>
        parsePoints(region.hitPathData ?? region.pathData),
      );

      for (let column = 0; column <= 200; column += 1) {
        for (let row = 0; row <= 480; row += 2) {
          const hits = polygons.filter((polygon) =>
            contains(polygon, { x: column, y: row }),
          );

          expect(hits.length).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("regionsForZone", () => {
  describe("when the zone has a single region", () => {
    it("returns that region", () => {
      expect(regionsForZone("LEFT_PEC")).toHaveLength(1);
      expect(regionsForZone("ASS")).toHaveLength(1);
    });
  });

  describe("when the zone appears on both views", () => {
    it("returns the front and the back region", () => {
      const ids = regionsForZone("LEFT_ARM").map((region) => region.id);

      expect(ids).toEqual(["front-left-arm", "back-left-arm"]);
    });
  });

  it("returns only regions of the requested zone", () => {
    for (const zone of BODY_ZONES) {
      expect(regionsForZone(zone).every((region) => region.zone === zone)).toBe(
        true,
      );
    }
  });
});
