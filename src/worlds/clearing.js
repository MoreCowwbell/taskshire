/**
 * The clearing the twelve short worlds share: the far-field hills ramp in from 55 units out to
 * 95 instead of from 40, and the colony floor on the bare ground never sinks below −0.35 (see
 * `groundHeight` in `src/world/setting.js`). One value for all twelve, so there is one number to
 * explain.
 *
 * **Why 55 to 95.** 55 is the smallest start, the same on every world, that lets each theme–world
 * pair deal the owner's 61 tiles in rings 0 to 11 with the burial guard on: starting at 50
 * leaves village Luna at 59. With 55 the tightest pair is village Luna at 66, and the rest are
 * at 68 or more. The hills used to rise over the 46 units from 40 to 86; the two ramps together
 * leave them the 40 from 55 to 95, so they start further out and rise somewhat faster over a
 * shorter band — at worst about two fifths steeper than before, near 77 units out.
 *
 * **Why −0.35.** The village's deck skirt reaches 0.4 below the deck, and its floor rule refuses
 * a cell whose ground dips below that. Cinder's three centre cells stood at −0.44, −0.41 and
 * −0.41, which split its test colony in two; holding the floor at −0.35 keeps a margin of 0.05
 * above the skirt and moves the ground in view by at most a fifth of a unit.
 *
 * Forest, Valley and Aerie carry none: their ground, and their screenshots, stay as they were.
 */
export const CLEARING = { from: 55, to: 95, floor: -0.35 }
