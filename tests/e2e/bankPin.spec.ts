import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { BankFetchOptions, BankPinStatus } from '../../src/shared/bank'
import type { AppSettings, BankAccountConfig, YearFile } from '../../src/shared/types'

interface BankCalls {
  fetched: { accountId: string; pin?: string; savePin?: boolean }[]
  deleted: string[]
}

const connection: BankAccountConfig = {
  id: 'pin-test', konto: 'haupt', label: 'Testbank', blz: '12345678',
  userId: 'Testperson', accountNumber: '123', fintsUrl: 'https://example.invalid/fints',
}

test('Bank-PIN erneut eingeben und unabhängig von der Bankverbindung entfernen', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buchfuehrung-e2e-bank-pin-'))
  try {
    const data = join(root, 'kassenwart', 'daten')
    mkdirSync(data, { recursive: true })
    const year: YearFile = {
      schemaVersion: 1, konto: 'haupt', year: 2026, clubName: 'Testverein', treasurerName: 'Testperson',
      openingBalance: 0, bookings: [], categories: [{ id: 'b', name: 'Beiträge', code: 'B', active: true, sortOrder: 1 }],
    }
    writeFileSync(join(data, 'kassenbuch-2026.json'), JSON.stringify(year))
    const settingsPath = join(data, 'einstellungen.json')
    writeFileSync(settingsPath, JSON.stringify({ theme: 'hell', bankAccounts: [connection] } satisfies AppSettings))

    const app = await electron.launch({ args: [resolve('tests/e2e/bootstrap.cjs')], env: { ...process.env, BUCHFUEHRUNG_TEST_ROOT: root } })
    try {
      await app.evaluate(({ ipcMain }) => {
        let status: BankPinStatus = 'saved'
        const calls: BankCalls = { fetched: [], deleted: [] }
        Object.assign(globalThis, { __bankPinTestCalls: calls })
        for (const channel of ['bank:pin:status', 'bank:pin:delete', 'bank:fetch']) ipcMain.removeHandler(channel)
        ipcMain.handle('bank:pin:status', (_event, id: string) => id === 'pin-test' ? status : 'missing')
        ipcMain.handle('bank:pin:delete', (_event, id: string) => {
          calls.deleted.push(id)
          status = 'missing'
        })
        ipcMain.handle('bank:fetch', (_event, account: BankAccountConfig, options: BankFetchOptions) => {
          calls.fetched.push({ accountId: account.id, pin: options.pin, savePin: options.savePin })
          return options.pin || status === 'saved' ? { status: 'ok', rows: [] } : { status: 'needPin' }
        })
      })
      const bankCalls = () => app.evaluate(() => (globalThis as typeof globalThis & { __bankPinTestCalls: BankCalls }).__bankPinTestCalls)
      const page = await app.firstWindow()
      await expect(page.getByRole('heading', { name: 'Vereinsübersicht', exact: true })).toBeVisible()
      await page.getByLabel('Konto wählen', { exact: true }).selectOption('haupt')
      await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: /Umsätze importieren/ }).click()
      await page.getByRole('button', { name: /^Online-Banking/ }).click()

      await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click()
      const form = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Bankkonto bearbeiten: Testbank' }) })
      const address = form.getByLabel('FinTS-Zugangsadresse')
      for (const width of [1280, 760]) {
        await page.setViewportSize({ width, height: 900 })
        const fieldBounds = await address.boundingBox()
        const formBounds = await form.boundingBox()
        expect(fieldBounds!.width).toBeGreaterThan(formBounds!.width * 0.8)
        expect(fieldBounds!.x + fieldBounds!.width).toBeLessThanOrEqual(width)
      }
      await expect(address).toHaveValue(connection.fintsUrl)
      await form.getByRole('button', { name: 'Abbrechen', exact: true }).click()

      const reenter = page.getByRole('button', { name: 'PIN erneut eingeben', exact: true })
      const pinDialog = page.getByRole('dialog', { name: 'PIN eingeben' })
      const pin = pinDialog.getByLabel('PIN', { exact: true })
      const remember = pinDialog.getByRole('checkbox', { name: 'PIN auf diesem Gerät speichern' })
      await expect(page.getByText('PIN gespeichert', { exact: true })).toBeVisible()
      await reenter.click()
      await expect(pin).toBeFocused()
      await expect(pin).toHaveAttribute('type', 'password')
      await expect(pin).toHaveValue('')
      await expect(remember).not.toBeChecked()
      await pinDialog.getByRole('button', { name: 'Abbrechen', exact: true }).click()
      await expect(pinDialog).toBeHidden()
      expect(await bankCalls()).toEqual({ fetched: [], deleted: [] })

      await reenter.click()
      await pin.fill('test-pin')
      await remember.check()
      await pinDialog.getByRole('button', { name: 'Abrufen', exact: true }).click()
      await expect(pinDialog).toBeHidden()
      await expect.poll(bankCalls).toEqual({ fetched: [{ accountId: connection.id, pin: 'test-pin', savePin: true }], deleted: [] })

      const remove = page.getByRole('button', { name: 'Gespeicherte PIN entfernen', exact: true })
      const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: /PIN entfernen/ }))
      await remove.click()
      await confirm.getByRole('button', { name: 'Abbrechen', exact: true }).click()
      await expect(confirm).toBeHidden()
      expect((await bankCalls()).deleted).toEqual([])

      await remove.click()
      await confirm.getByRole('button', { name: 'PIN entfernen', exact: true }).click()
      await expect(page.getByText('Keine PIN gespeichert', { exact: true })).toBeVisible()
      expect((await bankCalls()).deleted).toEqual([connection.id])
      expect((JSON.parse(readFileSync(settingsPath, 'utf8')) as AppSettings).bankAccounts).toEqual([connection])

      await page.getByRole('button', { name: 'Umsätze abrufen', exact: true }).click()
      await expect(pin).toBeVisible()
      await expect(pin).toHaveValue('')
    } finally {
      await app.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
