// @ts-check
/** @param {unknown} request @returns {void} */
export function showKnowledgeView(request) {
  const slot = /** @type {import('./show-dom.d.mts').ShowSectionRequest} */ (request);
  if (slot.phase === 'page') {
    const { parent, ctx } = slot;
    const labels = ctx.model.labels;
    if (labels.levels.length || Object.keys(labels.tags).length || labels.retiredTags.length || labels.customFields.length) {
      ctx.lazy(parent, 'Legend', body => {
        if (labels.levels.length) ctx.node('p', `Test levels: ${labels.levels.join(', ')}`, body);
        for (const [tag, meaning] of Object.entries(labels.tags)) ctx.node('p', `Tag ${tag}: ${meaning}`, body);
        if (labels.retiredTags.length) ctx.node('p', `Retired Tags: ${labels.retiredTags.join(', ')}`, body);
        for (const field of labels.customFields) {
          ctx.node('p', `${field.name}: ${field.description} · ${field.multiple ? 'several values' : 'one value'} · ${field.required ? 'required' : 'optional'}`, body);
          ctx.node('p', `Allowed values: ${field.values.join(', ')}${field.retired.length ? ` · Retired values: ${field.retired.join(', ')}` : ''}`, body);
        }
      });
    }
    return;
  }
  if (slot.phase !== 'feature') return;
  const { parent, feature, ctx } = slot;
  const knowledge = feature.knowledge;
  ctx.lazy(parent, 'Coverage', body => {
    ctx.node('p', `Deferred functionality: ${knowledge.deferred_count}`, body);
    if (knowledge.coverage_due) ctx.node('p', `Coverage due: ${knowledge.coverage_due.detail}`, body);
    if (!knowledge.coverage) ctx.node('p', 'No Coverage recorded.', body);
    for (const line of knowledge.coverage?.lines ?? []) {
      const row = ctx.node('p', `${line.key}: ${line.disposition}`, body);
      if (line.rules.length) ctx.keyed(row, ` by ${line.rules.join(', ')}`, feature.key);
      if (line.reason !== null) ctx.node('span', `: ${line.reason}`, row);
      for (const item of line.na) ctx.node('span', `; n/a for ${item.functionality}: ${item.reason}`, row);
    }
    for (const problem of knowledge.coverage?.problems ?? []) ctx.node('p', `${problem.code}: ${problem.message}`, body);
  });

  if (knowledge.deferred.length) ctx.lazy(parent, 'Deferred functionality', body => {
    for (const item of knowledge.deferred) {
      const row = ctx.node('p', `${item.functionality}: ${item.reason}. From: `, body);
      ctx.reference(row, item.reference);
      if (item.place !== null) ctx.node('span', `, ${item.place}`, row);
    }
  });
  if (knowledge.parked.length) ctx.lazy(parent, 'Parked questions', body => {
    for (const question of knowledge.parked) ctx.node('p', question.text, body);
  });
  if (knowledge.boundaries.length || knowledge.waivers.length) ctx.lazy(parent, 'Boundaries and Waivers', body => {
    for (const boundary of knowledge.boundaries) {
      ctx.node('p', `${boundary.key}: ${boundary.statement} · Owner: ${boundary.owner ?? 'none'}`, body);
      ctx.node('p', boundary.elaboration, body).className = 'knowledge-prose';
    }
    for (const waiver of knowledge.waivers) {
      const row = ctx.node('p', 'Waiver: ', body);
      ctx.keyed(row, waiver.key, feature.key);
      ctx.node('span', `: ${waiver.reason}`, row);
      ctx.node('p', waiver.elaboration, body).className = 'knowledge-prose';
    }
  });
}
