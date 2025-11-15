'use strict';

const { PrismaClient } = require('@prisma/client');

const StatusCode = require('../../utilities/message/status_code');
const FrameworkMessage = require('../../utilities/message/framework_message');
const DbCommonLibaray = require('../../utilities/publiclibrary/db_common_libaray');

const prisma = new PrismaClient();
const db = new DbCommonLibaray();

class FileService {
  constructor(client = prisma, dbClient = db) {
    this.prisma = client;
    this.db = dbClient;
  }

  async updateReadCount(id) {
    try {
      await this.prisma.cifile.update({
        where: { ID: id },
        data: { READCOUNT: { increment: 1 } }
      });
      return true;
    } catch {
      return false;
    }
  }

  getEntity(id) {
    return this.prisma.cifile.findUnique({ where: { ID: id } });
  }

  async exists(folderId, fileName) {
    const file = await this.prisma.cifile.findFirst({
      where: { FOLDERID: folderId, FILENAME: fileName }
    });
    return !file;
  }

  async download(id) {
    await this.updateReadCount(id);
    return this.getEntity(id);
  }

  async upload(folderId, fileName, fileContent, enabled = true) {
    const existing = await this.getId(folderId, fileName);
    if (existing) {
      await this.updateFile(existing, fileName, fileContent);
      return existing;
    }
    const entity = {
      ID: undefined,
      FOLDERID: folderId,
      FILENAME: fileName,
      FILECONTENT: fileContent,
      ENABLED: enabled ? 1 : 0
    };
    const { returnValue } = await this.addEntity(entity);
    return returnValue;
  }

  getDTByFolder(folderId) {
    const sql = `
      SELECT ID, FOLDERID, FILENAME, FILEPATH, FILESIZE, READCOUNT, CATEGORY,
             DESCRIPTION, ENABLED, SORTCODE, CREATEUSERID, CREATEBY, CREATEON,
             MODIFIEDUSERID, MODIFIEDBY, MODIFIEDON,
             (SELECT FOLDERNAME FROM cifolder WHERE ID = FOLDERID) AS folderfullname
        FROM cifile
       WHERE FOLDERID = '${folderId}'
    `;
    return this.db.executeQuery(sql);
  }

  async getFileDTByPage(pageIndex = 1, pageSize = 20, whereConditional = '', order = '') {
    const selectFields = `
      ID, FOLDERID, FILENAME, FILEPATH, FILESIZE, READCOUNT, CATEGORY, DESCRIPTION,
      ENABLED, SORTCODE, CREATEUSERID, CREATEBY, CREATEON, MODIFIEDUSERID, MODIFIEDBY,
      MODIFIEDON,
      (SELECT FOLDERNAME FROM cifolder WHERE ID = FOLDERID) AS FolderFullName
    `;
    const result = await this.db.getDTByPage(
      'cifile',
      whereConditional,
      order || 'CREATEON DESC',
      selectFields,
      pageIndex,
      pageSize
    );
    return result;
  }

  deleteByFolder(folderId) {
    return this.prisma.cifile.deleteMany({ where: { FOLDERID: folderId } });
  }

  async add(userInfo, folderId, fileName, file, description, category, enabled) {
    const nameAvailable = await this.exists(folderId, fileName);
    if (!nameAvailable) {
      return { returnCode: StatusCode.ErrorNameExist, returnMessage: FrameworkMessage.MSG0008, fileEntity: null };
    }

    const now = new Date();
    const fileEntity = {
      ID: undefined,
      FOLDERID: folderId,
      FILENAME: fileName,
      FILECONTENT: file,
      DESCRIPTION: description,
      CATEGORY: category,
      DELETEMARK: 0,
      CREATEON: now,
      MODIFIEDON: now,
      ENABLED: enabled ? 1 : 0
    };

    const result = await this.addEntity(fileEntity);
    return { returnCode: result.returnCode, returnMessage: result.returnMessage, fileEntity: result.returnValue };
  }

  async update(userInfo, id, folderId, fileName, description, enabled) {
    try {
      const result = await this.prisma.cifile.update({
        where: { ID: id },
        data: {
          FOLDERID: folderId,
          FILENAME: fileName,
          ENABLED: enabled ? 1 : 0,
          DESCRIPTION: description,
          MODIFIEDUSERID: userInfo?.Id || null,
          MODIFIEDBY: userInfo?.UserName || null,
          MODIFIEDON: new Date()
        }
      });
      return {
        returnCode: StatusCode.OKUpdate,
        returnMessage: FrameworkMessage.MSG0010,
        returnValue: result
      };
    } catch (error) {
      console.error('[FileService.update]', error);
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001, returnValue: null };
    }
  }

  async updateFile(id, fileName, file) {
    try {
      const result = await this.prisma.cifile.update({
        where: { ID: id },
        data: { FILENAME: fileName, FILECONTENT: file, MODIFIEDON: new Date() }
      });
      return { returnCode: StatusCode.OKUpdate, returnMessage: FrameworkMessage.MSG0010, returnValue: result };
    } catch (error) {
      console.error('[FileService.updateFile]', error);
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001, returnValue: null };
    }
  }

  async rename(id, newName, enabled) {
    try {
      const result = await this.prisma.cifile.update({
        where: { ID: id },
        data: { FILENAME: newName, ENABLED: enabled ? 1 : 0 }
      });
      return { returnCode: StatusCode.OKUpdate, returnMessage: FrameworkMessage.MSG0010, returnValue: result };
    } catch (error) {
      console.error('[FileService.rename]', error);
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001, returnValue: null };
    }
  }

  search() {
    return [];
  }

  async moveTo(id, folderId) {
    try {
      const result = await this.prisma.cifile.update({
        where: { ID: id },
        data: { FOLDERID: folderId }
      });
      return { returnCode: StatusCode.OKUpdate, returnMessage: FrameworkMessage.MSG0010, returnValue: result };
    } catch (error) {
      console.error('[FileService.moveTo]', error);
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001, returnValue: null };
    }
  }

  async batchMoveTo(ids = [], folderId) {
    try {
      const result = await this.prisma.cifile.updateMany({
        where: { ID: { in: ids } },
        data: { FOLDERID: folderId }
      });
      return { returnCode: StatusCode.OKUpdate, returnMessage: FrameworkMessage.MSG0010, returnValue: result };
    } catch (error) {
      console.error('[FileService.batchMoveTo]', error);
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001, returnValue: null };
    }
  }

  delete(id) {
    return this.prisma.cifile.delete({ where: { ID: id } });
  }

  batchDelete(ids = []) {
    return this.prisma.cifile.deleteMany({ where: { ID: { in: ids } } });
  }

  async batchSave(dataTable = []) {
    try {
      await this.prisma.$transaction(
        dataTable.map((record) =>
          this.prisma.cifile.upsert({
            where: { ID: record.ID || '' },
            create: record,
            update: record
          })
        )
      );
      return dataTable.length;
    } catch (error) {
      console.error('[FileService.batchSave]', error);
      return 0;
    }
  }

  async getId(folderId, fileName) {
    const file = await this.prisma.cifile.findFirst({
      where: { FOLDERID: folderId, FILENAME: fileName }
    });
    return file?.ID || null;
  }

  async addEntity(fileEntity) {
    try {
      const record = await this.prisma.cifile.create({ data: fileEntity });
      return { returnCode: StatusCode.OKAdd, returnMessage: FrameworkMessage.MSG0009, returnValue: record.ID };
    } catch (error) {
      console.error('[FileService.addEntity]', error);
      return { returnCode: StatusCode.DbError, returnMessage: FrameworkMessage.MSG0001, returnValue: null };
    }
  }
}

module.exports = {
  FileService,
  fileService: new FileService()
};
