/**
 * The design department's field sets: the architect's, the interior and
 * landscape designer's, the structural engineer's and the services
 * engineer's. Twenty-two functions, each a workstream of Design.
 *
 * The sets themselves are in `design/`, one file to a profession, with the
 * rule rows they read. They are gathered here so the folder's index names
 * one file for the group.
 */

import type { FieldSet } from '../types';
import { ARCHITECT_FIELD_SETS } from './design/architect';
import { INTERIOR_FIELD_SETS } from './design/interiors';
import { SERVICES_FIELD_SETS } from './design/services';
import { STRUCTURE_FIELD_SETS } from './design/structure';

export const DESIGN_FIELD_SETS: FieldSet[] = [...ARCHITECT_FIELD_SETS, ...INTERIOR_FIELD_SETS, ...STRUCTURE_FIELD_SETS, ...SERVICES_FIELD_SETS];

export { DESIGN_RULE_ROWS, DESIGN_RULE_SHAPES } from './design/rule-rows';
