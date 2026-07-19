import fs from 'node:fs'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
pkg.version = process.env.APP_VERSION
pkg.build.publish = [{
  provider: 'github',
  owner: 'fishdulyapath',
  repo: 'laopos',
  releaseType: process.env.RELEASE_TYPE || 'release',
  private: true,
}]
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2))
console.log(`[set-build-config] version=${pkg.version} releaseType=${pkg.build.publish[0].releaseType}`)
