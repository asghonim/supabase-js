import { afterEach } from 'vitest'

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500))
})
