/**
 * FSRE BUILDING — WHO THE DISPATCHER'S ACTORS ARE.
 *
 * The suite's events name an `actor`. In the replay export that is a skill
 * name (`fs-intake`, `review-manager`), and the building seats a skill at
 * its desk. The VPS dispatcher (infra/hermes, not in any repository yet)
 * names its agents instead — `data-staff-a` and the like — and an actor the
 * building does not know as a skill falls to the lobby bench, which is the
 * wrong desk (PRD "FSRE publish path" G6).
 *
 * This is the one place that maps an agent id to the skill whose desk it
 * works at: a configuration, not logic. It starts EMPTY on purpose (decision
 * O5): the dispatcher's real ids are not available yet, and a guessed roster
 * would seat agents at desks they do not sit at. When Dika sends
 * `dispatch.json` (no secret in it), its entries go here, one line each, in
 * the same commit as the test that reads them. An id absent from the roster
 * keeps today's behaviour: the actor stands as its own name, and the lobby
 * bench says so. Never derive an entry from a name's shape: `data-staff-a`
 * says "data" only by convention, and a convention is not a roster.
 */

/** Agent id (the suite's `actor`) → the skill whose desk it works at. */
export const ACTOR_ROSTER: Readonly<Record<string, string>> = Object.freeze({
  // Filled from dispatch.json when Dika sends it (O5). Empty until then.
});

/** The skill an actor is rostered to, or null for a skill name or an unknown id. */
export function rosterSkill(actor: string, roster: Readonly<Record<string, string>> = ACTOR_ROSTER): string | null {
  return Object.prototype.hasOwnProperty.call(roster, actor) ? roster[actor] : null;
}
