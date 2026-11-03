import type { StyleSpecification } from 'maplibre-gl'

// Stand-ins for a missing property that leave a comparison false, as MapLibre already
// treats it, without the "Expected value to be of type number, but found null" warning.
const MISSING: Record<string, number> = { '<': 1e12, '<=': 1e12, '>': -1e12, '>=': -1e12 }

const isGet = (value: unknown): value is ['get', string] =>
  Array.isArray(value) && value.length === 2 && value[0] === 'get' && typeof value[1] === 'string'

function patchExpression(expression: unknown): unknown {
  if (!Array.isArray(expression)) return expression
  const [op, left, right] = expression
  if (typeof op === 'string' && op in MISSING && expression.length === 3 && isGet(left) && typeof right === 'number') {
    return [op, ['coalesce', left, MISSING[op]], right]
  }
  return expression.map(patchExpression)
}

/**
 * OpenFreeMap Liberty compares road-shield properties such as `ref_length` with numbers,
 * and most roads in India have none, so MapLibre logs a warning for every such layer.
 * This gives the missing value an explicit stand-in with the same (false) outcome; the
 * style is otherwise unchanged, including its sources and attribution.
 */
export function quietMissingComparisons(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    layers: style.layers.map((layer) =>
      'filter' in layer && layer.filter ? ({ ...layer, filter: patchExpression(layer.filter) } as typeof layer) : layer,
    ),
  }
}
