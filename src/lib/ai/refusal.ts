// R67 lane B (B-05) -- THE ONE SENTENCE A MODEL REFUSAL IS ALLOWED TO SAY.
//
// R66 recorded a user being told "AI is not available for this account." with
// no next step, for a question the database could answer perfectly well
// without a model. The model was only ever going to add commentary on top of
// the records, so its absence costs a sentence, not the answer -- and the
// sentence must say so.
//
// A LEAF MODULE ON PURPOSE: adapter.ts (where the refusal is thrown) and the
// pipeline's dry-run (where the records are returned instead) both need this
// exact string, and a shared constant is the only way two very different
// layers can be guaranteed to say the same thing. It imports nothing, so
// neither of them gains a cycle.
export const NO_COMMENTARY_SENTENCE = "VERI can't add commentary right now - here is what the records say";
