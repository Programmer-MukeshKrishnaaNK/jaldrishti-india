/**
 * ESA WorldCover 2021 classes with PaaniPulse's runoff-coefficient assumptions.
 *
 * A runoff coefficient is the share of rainfall that becomes surface runoff in the
 * rational method. Published tables give ranges by surface type (for example, the
 * CPHEEO Manual on Storm Water Drainage Systems, 2019, and FHWA HEC-22); WorldCover
 * classes are broader than those surface types, so each value below is an assumption
 * chosen with the reasoning shown. None is calibrated to a local measurement, and all
 * can be changed in the app.
 */
export interface LandCoverClass {
  code: number
  name: string
  coefficient: number
  reasoning: string
}

export const WORLDCOVER_CLASSES: LandCoverClass[] = [
  {
    code: 10,
    name: 'Tree cover',
    coefficient: 0.15,
    reasoning: 'Canopy and litter intercept rain and soils under trees infiltrate well; woodland sits at the low end of rational-method tables.',
  },
  {
    code: 20,
    name: 'Shrubland',
    coefficient: 0.25,
    reasoning: 'Sparser cover than trees, so more rain reaches the ground and runs off.',
  },
  {
    code: 30,
    name: 'Grassland',
    coefficient: 0.25,
    reasoning: 'Similar to parks and lawns on mixed soils, which tables place around 0.1–0.35.',
  },
  {
    code: 40,
    name: 'Cropland',
    coefficient: 0.3,
    reasoning: 'Cultivated soil infiltrates less than grass once compacted or bare between crops.',
  },
  {
    code: 50,
    name: 'Built-up',
    coefficient: 0.8,
    reasoning: 'Roofs and paving are tabulated at about 0.85–0.95; reduced slightly because 10 m built-up pixels include gaps, yards and unpaved lanes.',
  },
  {
    code: 60,
    name: 'Bare / sparse vegetation',
    coefficient: 0.5,
    reasoning: 'Exposed earth often crusts or is compacted, shedding more rain than vegetated ground.',
  },
  {
    code: 70,
    name: 'Snow and ice',
    coefficient: 0.9,
    reasoning: 'Frozen surfaces do not absorb rain.',
  },
  {
    code: 80,
    name: 'Permanent water',
    coefficient: 1,
    reasoning: 'Rain falling on open water all joins the water body; none infiltrates.',
  },
  {
    code: 90,
    name: 'Herbaceous wetland',
    coefficient: 0.8,
    reasoning: 'Usually saturated, so little further rain can soak in.',
  },
  {
    code: 95,
    name: 'Mangroves',
    coefficient: 0.8,
    reasoning: 'Tidal, saturated ground with little spare infiltration capacity.',
  },
  {
    code: 100,
    name: 'Moss and lichen',
    coefficient: 0.3,
    reasoning: 'Thin cover over rock or soil; rare in India.',
  },
]

export const WORLDCOVER_CODES = WORLDCOVER_CLASSES.map((c) => c.code)

/** Index of a WorldCover class code in WORLDCOVER_CLASSES, or -1. */
export function classIndex(code: number): number {
  return WORLDCOVER_CODES.indexOf(code)
}

export function defaultCoefficients(): number[] {
  return WORLDCOVER_CLASSES.map((c) => c.coefficient)
}
