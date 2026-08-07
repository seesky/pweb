-- Existing relay nodes were created by platform administrators and therefore
-- remain globally available. New tenant nodes explicitly use SCOPE='tenant'.
ALTER TABLE `poleis_relay_node`
  ADD COLUMN `SCOPE` VARCHAR(20) NOT NULL DEFAULT 'global' AFTER `ID`,
  ADD INDEX `poleis_relay_node_SCOPE_TENANTID_idx` (`SCOPE`, `TENANTID`);

UPDATE `poleis_relay_node`
   SET `SCOPE` = 'global'
 WHERE `SCOPE` IS NULL OR `SCOPE` = '';
