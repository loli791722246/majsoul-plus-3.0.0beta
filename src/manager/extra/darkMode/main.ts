import { MajsoulPlus } from '../../../majsoul_plus'

function changeTheme(mode: string) {
  const extraCss = document.querySelector('#extraCss')
  if (mode === 'dark') {
    extraCss['href'] = './extra/darkMode/style.css'
  }
}

export default function darkMode(userConfig: MajsoulPlus.UserConfig) {
  const query = window.matchMedia('(prefers-color-scheme: dark)')

  const setOSTheme = () => {
    changeTheme(query.matches ? 'dark' : 'light')
  }

  if (query.addEventListener) {
    query.addEventListener('change', setOSTheme)
  }

  setOSTheme()
  // changeTheme(userConfig.window.OSTheme)
}
