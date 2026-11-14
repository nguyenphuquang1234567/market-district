const projectId = 'prj_m3YpoEywdOi7kptY6xdsWjrZJHB9';
const teamId = 'team_XV0yqENlDJuiiWHigYHgtr51';
const dryRun = process.env.CLEANUP_DRY_RUN !== 'false';
const token = process.env.VERCEL_CLEANUP_TOKEN;
const id = deployment => deployment.id ?? deployment.uid;
const created = deployment => deployment.createdAt ?? deployment.created;

async function api(path, method = 'GET') {
  const url = new URL(path, 'https://api.vercel.com');
  url.searchParams.set('teamId', teamId);
  const response = await fetch(url, {
    method, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404 && method === 'DELETE') return;
  if (!response.ok) throw new Error(`Vercel ${method} ${url.pathname}: HTTP ${response.status}`);
  if (method === 'GET') return response.json();
}

async function currentProduction() {
  const project = await api(`/v9/projects/${projectId}`);
  const current = project.targets?.production;
  if (project.id !== projectId || project.name !== 'market-district' || !id(current ?? {}) || current.readyState !== 'READY') {
    throw new Error('Cannot verify a ready Market District production deployment');
  }
  return current;
}

async function listProduction() {
  const deployments = [];
  const seen = new Set();
  let cursor;
  do {
    const query = new URLSearchParams({ projectId, target: 'production', limit: '100' });
    if (cursor) query.set('until', String(cursor));
    const page = await api(`/v6/deployments?${query}`);
    deployments.push(...page.deployments.filter(deployment => deployment.target === 'production'));
    cursor = page.pagination?.next;
    if (cursor && seen.has(cursor)) throw new Error('Repeated Vercel pagination cursor');
    seen.add(cursor);
  } while (cursor);
  return deployments.sort((left, right) => created(right) - created(left));
}

async function main() {
  if (!token) throw new Error('VERCEL_CLEANUP_TOKEN is missing');

  // A push can reach Actions before Vercel promotes its build. Let the successful commit go live first.
  const expectedCommit = process.env.EXPECTED_COMMIT;
  let current;
  for (let attempt = 0; attempt < 20; attempt++) {
    current = await currentProduction();
    if (!expectedCommit || current.meta?.githubCommitSha === expectedCommit) break;
    if (attempt === 19) {
      console.log('This commit did not become production. Scheduled cleanup will check the live deployment.');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
  const currentId = id(current);
  const production = await listProduction();
  const live = production.find(deployment => id(deployment) === currentId && deployment.state === 'READY');
  if (!live || !Number.isFinite(created(live))) throw new Error('Live deployment not found in the production list');
  const rollback = production.find(deployment => id(deployment) !== currentId && deployment.state === 'READY');
  if (!rollback) {
    console.log('One ready production deployment; keeping it.');
    return;
  }
  const keep = new Set([currentId, id(rollback)]);
  let removed = 0, eligible = 0;
  for (const deployment of production) {
    const deploymentId = id(deployment);
    if (!deploymentId || keep.has(deploymentId) || !['READY', 'ERROR', 'CANCELED'].includes(deployment.state) ||
        !Number.isFinite(created(deployment)) || created(deployment) >= created(live)) continue;

    const detail = await api(`/v13/deployments/${deploymentId}`);
    if (detail.projectId !== projectId || detail.target !== 'production' ||
        !['READY', 'ERROR', 'CANCELED'].includes(detail.readyState ?? detail.state)) continue;
    const { aliases } = await api(`/v2/deployments/${deploymentId}/aliases`);
    if (aliases.length) {
      console.log(`Kept ${deploymentId} because it still has an alias`);
      continue;
    }

    eligible++;
    console.log(`${dryRun ? 'Would delete' : 'Deleting'} ${deploymentId}`);
    if (dryRun) continue;
    if (id(await currentProduction()) !== currentId) throw new Error('Production changed during cleanup');
    await api(`/v13/deployments/${deploymentId}`, 'DELETE');
    removed++;
  }
  console.log(`Keeping ${[...keep].join(', ')}. Found ${eligible} eligible, deleted ${removed}.`);
}

try { await main(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
