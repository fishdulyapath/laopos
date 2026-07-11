import { spawnSync } from 'node:child_process'

const port = process.env.BIZSUIT_WEB_PORT || '8090'
const compose = process.env.DOCKER_COMPOSE || 'docker compose'
const project = process.env.COMPOSE_PROJECT_NAME || `bizsuit-smoke-${Date.now()}`

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    env: { ...process.env, COMPOSE_PROJECT_NAME: project, BIZSUIT_WEB_PORT: port },
  })
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`${command} ${args.join(' ')} failed${output ? `\n${output}` : ''}`)
  }
  return result
}

async function waitFor(url, expect, attempts = 40) {
  let last = ''
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url)
      last = await res.text()
      if (res.ok && (!expect || last.includes(expect))) return
    } catch (error) {
      last = error.message
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`smoke check failed for ${url}: ${last.slice(0, 200)}`)
}

const [dockerCommand, ...composeArgs] = compose.split(/\s+/).filter(Boolean)

try {
  run(dockerCommand, [...composeArgs, 'up', '--build', '-d'])
  await waitFor(`http://127.0.0.1:${port}/healthz`, 'ok')
  await waitFor(`http://127.0.0.1:${port}/bizsuit/`, '<div id="app">')
  console.log(JSON.stringify({
    status: 'PASS',
    project,
    checks: [
      `http://127.0.0.1:${port}/healthz`,
      `http://127.0.0.1:${port}/bizsuit/`,
    ],
  }, null, 2))
} finally {
  if (process.env.KEEP_DOCKER_SMOKE !== '1') {
    run(dockerCommand, [...composeArgs, 'down', '--remove-orphans'])
  }
}
