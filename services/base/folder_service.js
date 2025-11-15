'use strict';

const { PrismaClient } = require('@prisma/client');

const StatusCode = require('../../utilities/message/status_code');
const FrameworkMessage = require('../../utilities/message/framework_message');

const prisma = new PrismaClient();

class FolderService {
  constructor(client = prisma) {
    this.prisma = client;
  }

  async exists(parentId, folderName) {
    const folder = await this.prisma.cifolder.findFirst({
      where: { PARENTID: parentId, FOLDERNAME: folderName }
    });
    return !folder;
  }

  getEntity(id) {
    return this.prisma.cifolder.findUnique({ where: { ID: id } });
  }

  getDT(valueDic = {}) {
    return this.prisma.cifolder.findMany({ where: valueDic });
  }

  getDTByParent(parentId) {
    return this.prisma.cifolder.findMany({
      where: { DELETEMARK: 0, PARENTID: parentId },
      orderBy: { SORTCODE: 'asc' }
    });
  }

  async addByFolderName(userInfo, parentId, folderName, enabled) {
    const nameAvailable = await this.exists(parentId, folderName);
    if (!nameAvailable) {
      return { returnCode: StatusCode.ErrorNameExist, returnMessage: FrameworkMessage.MSG0008, id: null };
    }
    const now = new Date();
    const folderEntity = {
      FOLDERNAME: folderName,
      PARENTID: parentId,
      ENABLED: enabled ? 1 : 0,
      DELETEMARK: 0,
      CREATEON: now,
      CREATEBY: userInfo?.UserName || null,
      CREATEUSERID: userInfo?.Id || null,
      MODIFIEDON: now,
      MODIFIEDBY: userInfo?.UserName || null,
      MODIFIEDUSERID: userInfo?.Id || null
    };
    const result = await this.add(folderEntity);
    return { returnCode: result.returnCode, returnMessage: result.returnMessage, id: result.returnValue };
  }

  async add(folderEntity) {
    try {
      const record = await this.prisma.cifolder.create({ data: folderEntity });
      return { returnCode: StatusCode.OKAdd, returnMessage: FrameworkMessage.MSG0009, returnValue: record.ID };
    } catch (error) {
      console.error('[FolderService.add]', error);
      return { returnCode: StatusCode.DbError, returnMessage: FrameworkMessage.MSG0001, returnValue: null };
    }
  }

  async update(folderEntity) {
    if (!folderEntity?.ID) {
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
    try {
      await this.prisma.cifolder.update({
        where: { ID: folderEntity.ID },
        data: folderEntity
      });
      return { returnCode: StatusCode.OKUpdate, returnMessage: FrameworkMessage.MSG0010 };
    } catch (error) {
      console.error('[FolderService.update]', error);
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
  }

  getAll() {
    return this.prisma.cifolder.findMany();
  }

  async rename(id, newName, enabled) {
    try {
      await this.prisma.cifolder.update({
        where: { ID: id },
        data: { FOLDERNAME: newName, ENABLED: enabled ? 1 : 0 }
      });
      return { returnCode: StatusCode.OKUpdate, returnMessage: FrameworkMessage.MSG0010 };
    } catch (error) {
      console.error('[FolderService.rename]', error);
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
  }

  search() {
    return [];
  }

  delete(id) {
    return this.prisma.cifolder.delete({ where: { ID: id } });
  }

  batchDelete(ids = []) {
    return this.prisma.cifolder.deleteMany({ where: { ID: { in: ids } } });
  }

  async moveTo(folderId, parentId) {
    try {
      await this.prisma.cifolder.update({
        where: { ID: folderId },
        data: { PARENTID: parentId }
      });
      return { returnCode: StatusCode.OKUpdate, returnMessage: FrameworkMessage.MSG0010 };
    } catch (error) {
      console.error('[FolderService.moveTo]', error);
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
  }

  async batchMoveTo(folderIds = [], parentId) {
    try {
      await this.prisma.cifolder.updateMany({
        where: { ID: { in: folderIds } },
        data: { PARENTID: parentId }
      });
      return { returnCode: StatusCode.OKUpdate, returnMessage: FrameworkMessage.MSG0010 };
    } catch (error) {
      console.error('[FolderService.batchMoveTo]', error);
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
  }

  async batchSave(dataTable = []) {
    try {
      await this.prisma.$transaction(
        dataTable.map((record) =>
          this.prisma.cifolder.upsert({
            where: { ID: record.ID || '' },
            create: record,
            update: record
          })
        )
      );
      return dataTable.length;
    } catch (error) {
      console.error('[FolderService.batchSave]', error);
      return 0;
    }
  }
}

module.exports = {
  FolderService,
  folderService: new FolderService()
};
