const SUPPORTS_COLOR =
  process.stdout.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb';

const ESC = String.fromCharCode(27);
const wrap = (code) => (text) => (SUPPORTS_COLOR ? `${ESC}[${code}m${text}${ESC}[0m` : text);

export const bold = wrap('1');
export const dim = wrap('2');
export const accent = wrap('38;5;208');
export const red = wrap('31');
export const green = wrap('32');
export const yellow = wrap('33');

export function line(text = '') {
  process.stdout.write(`${text}\n`);
}

export function step(index, total, message) {
  line(`${dim(`[${index}/${total}]`)} ${message}`);
}

export function ok(message) {
  line(`      ${green('OK')} ${dim(message)}`);
}

export function warn(message) {
  line(`      ${yellow('!')} ${message}`);
}

/** Every failure tells the user what to do next, not just what broke (brief 9). */
export function fail(title, remedy) {
  line();
  line(`  ${red('x')} ${bold(title)}`);
  if (remedy) {
    line();
    for (const item of Array.isArray(remedy) ? remedy : [remedy]) {
      line(`    ${item}`);
    }
  }
  line();
  process.exit(1);
}

export function banner({ url, dataDirectory, mode }) {
  line();
  line(`  ${bold('AI Footprint')}`);
  line(`  ${dim('Understand how you use AI.')}`);
  line();
  line(`  ${dim('App ')}  ${accent(url)}`);
  line(`  ${dim('Data')}  ${dataDirectory}`);
  line(`  ${dim('Mode')}  ${mode}`);
  line();
  line(`  ${dim('Built by')} Zyfolks Technologies ${dim('·')} ${dim('zyfolks.com')}`);
  line();
}
