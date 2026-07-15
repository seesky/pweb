'use strict';

const fs = require('node:fs');
const path = require('node:path');
const CommonUtils = require('../utilities/publiclibrary/common_utils');
const releaseService = require('../services/release_service');

const user = (req, res) => req.currentUser || CommonUtils.getCurrent(res, req);
const downloadUrl = (req, id) => `${req.protocol}://${req.get('host')}/downloads/releases/${id}`;
const withUrl = (req, release) => release ? { ...release, downloadUrl: downloadUrl(req, release.id) } : null;

exports.list = async (req, res) => {
  try {
    const data = (await releaseService.listReleases()).map((release) => withUrl(req, release));
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Release.list]', error);
    res.status(500).json({ success: false, message: '加载版本列表失败' });
  }
};

exports.create = async (req, res) => {
  try {
    const release = await releaseService.createRelease(req.body || {}, req.file, user(req, res));
    res.json({ success: true, message: '版本已发布', data: withUrl(req, release) });
  } catch (error) {
    if (req.file?.path) fs.rmSync(req.file.path, { force: true });
    console.error('[Release.create]', error);
    res.status(error.code === 'INVALID_REQUEST' ? 400 : 500).json({ success: false, message: error.message || '发布版本失败' });
  }
};

exports.update = async (req, res) => {
  try {
    const release = await releaseService.updateRelease(req.params.id, req.body || {}, user(req, res));
    if (!release) return res.status(404).json({ success: false, message: '版本不存在' });
    res.json({ success: true, message: '版本已更新', data: withUrl(req, release) });
  } catch (error) {
    console.error('[Release.update]', error);
    res.status(500).json({ success: false, message: '更新版本失败' });
  }
};

exports.remove = async (req, res) => {
  try {
    const deleted = await releaseService.deleteRelease(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: '版本不存在' });
    res.json({ success: true, message: '版本已删除' });
  } catch (error) {
    console.error('[Release.remove]', error);
    res.status(500).json({ success: false, message: '删除版本失败' });
  }
};

exports.latest = async (req, res) => {
  try {
    const currentVersionCode = Number(req.query.currentVersionCode || 0);
    const release = await releaseService.latestRelease(req.query || {});
    if (!release) return res.json({ success: true, updateAvailable: false, data: null });
    const updateAvailable = release.versionCode > currentVersionCode;
    const mandatory = updateAvailable && (release.mandatory || currentVersionCode < release.minSupportedVersionCode);
    res.json({ success: true, updateAvailable, mandatory, data: withUrl(req, { ...release, mandatory }) });
  } catch (error) {
    console.error('[Release.latest]', error);
    res.status(500).json({ success: false, message: '检查更新失败' });
  }
};

exports.downloads = async (req, res) => {
  try {
    const data = (await releaseService.latestDownloads()).map((release) => withUrl(req, release));
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Release.downloads]', error);
    res.status(500).json({ success: false, message: '加载下载列表失败' });
  }
};

exports.download = async (req, res) => {
  try {
    const resolved = await releaseService.resolveFile(req.params.id);
    if (!resolved) return res.status(404).send('Release not found');
    await releaseService.incrementDownload(req.params.id);
    res.download(resolved.filePath, path.basename(resolved.row.ORIGINALNAME));
  } catch (error) {
    console.error('[Release.download]', error);
    res.status(500).send('Download failed');
  }
};
