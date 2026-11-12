-- Per-group currency label for the calculator, used to target /pkr, /usdt,
-- and /account broadcasts. No DEFAULT: NULL means "never labeled" and must
-- stay that way until an admin explicitly runs /pkr or /usdt in that group —
-- a default here would silently sweep existing groups into broadcasts they
-- never opted into. Adding the column with no default already leaves every
-- existing row NULL, which is the one-time reset this needs.
ALTER TABLE calculation_balances
  ADD COLUMN IF NOT EXISTS currency TEXT CHECK (currency IN ('pkr', 'usdt'));
