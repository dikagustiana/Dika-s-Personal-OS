import { describe, expect, it } from 'vitest';
import skillsFile from '../../../data/fsre/skills.json';
import stagesFile from '../../../data/fsre/stages.json';
import { ACTOR_ROSTER, rosterSkill } from './actorRoster';

const KNOWN_SKILLS = new Set([...skillsFile.skills.map((s) => s.name), ...stagesFile.stages.flatMap((s) => s.skills)]);

describe('the actor roster', () => {
  it('starts empty (O5: the dispatcher’s ids are not available yet), and is frozen', () => {
    expect(Object.keys(ACTOR_ROSTER)).toEqual([]);
    expect(Object.isFrozen(ACTOR_ROSTER)).toBe(true);
  });

  it('maps every rostered id to a skill the data knows, so an entry can never seat an agent at a desk that does not exist', () => {
    for (const [actor, skill] of Object.entries(ACTOR_ROSTER)) expect(KNOWN_SKILLS.has(skill), `${actor} → ${skill}`).toBe(true);
  });

  it('answers null for an unknown id and for a skill name, and the skill for a rostered id', () => {
    expect(rosterSkill('hermes-7')).toBeNull();
    expect(rosterSkill('fs-intake')).toBeNull();
    expect(rosterSkill('toString')).toBeNull(); // an inherited property is not an entry
    expect(rosterSkill('data-staff-a', { 'data-staff-a': 'fs-intake' })).toBe('fs-intake');
  });
});
