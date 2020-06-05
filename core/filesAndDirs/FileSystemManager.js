const path = require('path');
const fs = require('fs');

const File  = require('./File.js');
const Directory = require('./Directory.js');
const FileBackedCollection = require('../FileBackedCollection.js');
const utilities = require('../utilities.js');

/*
 * This class manages the state of the files and directories that storyteller
 * is tracking. Files and directories may be moved, renamed, and deleted over 
 * time but only one object is stored in memory for each one. These are used
 * to keep track of the history of all files and directories over time.
 * There are two collections, allFiles and allDirs, that store File and 
 * Directory objects for the file system elements that have been created. 
 * Storyteller tracks objects by their ids. There are two other objects, 
 * pathToFileIdMap and pathToDirIdMap, that map actual file and directory 
 * paths to storyteller file and dir ids. 
 */
class FileSystemManager extends FileBackedCollection {
    constructor(storytellerDirPath) {
        //init the base class
        super(storytellerDirPath, 'fs', 'filesAndDirs.json');
        
        //if the json file exists
        if(this.fileExists()) {
            //read the data from the file and load the file and dir info
            this.read();
        } else { //no json file exists
            //create the collection of all file and all directory objects
            this.allFiles = {};
            this.allDirs = {};

            //create the collection of all path to id mappings
            this.pathToFileIdMap = {};
            this.pathToDirIdMap = {};
            
            //init the auto generating values
            File.nextId = 0;
            Directory.nextId = 0;
            
            //write the relevant data to the file
            this.write();
        }
    }

    /*
     * Writes the data to a json file.
     */
    write() {
        //ask each file in the storyteller system to update its last modified date
        this.updateLastModifiedDates();

        //pass in an object to be written to a json file
        super.write({
            allFiles: this.allFiles, 
            allDirs: this.allDirs, 
            pathToFileIdMap: this.pathToFileIdMap,
            pathToDirIdMap: this.pathToDirIdMap,
            fileAutoGeneratedId: File.nextId,
            directoryAutoGeneratedId: Directory.nextId
        });
    }

    /*
     * Reads data from a json file into memory. Converts some the files and
     * directories into instances of the class.
     */
    read() {
        //read the data from the file
        const anObject = super.read();

        //store the data from the file back into this object
        this.pathToFileIdMap = anObject.pathToFileIdMap;
        this.pathToDirIdMap = anObject.pathToDirIdMap;
        
        //store the raw objects in memory 
        this.allFiles = anObject.allFiles;
        this.allDirs = anObject.allDirs;

        //go through and make all of the raw objects true File objects
        for(let fileId in this.allFiles) {
            //get the file data
            const file = this.allFiles[fileId];
            //create a File object
            this.allFiles[fileId] = new File(file.parentDirectoryId, file.currentPath, file.lastModifiedDate, file.textFileInsertEvents, file.isDeleted, file.id);
        }
        
        //go through and make all of the objects true Directory objects
        for(let dirId in this.allDirs) {
            //get the dir data
            const dir = this.allDirs[dirId];
            //create the Directory object
            this.allDirs[dirId] = new Directory(dir.parentDirectoryId, dir.currentPath, dir.isDeleted, dir.id);
        }
        
        //set the auto-generated ids for the two classes
        File.nextId = anObject.fileAutoGeneratedId;
        Directory.nextId = anObject.directoryAutoGeneratedId; 
    }

    /*
     * Adds a new file to the file system
     */
    addFile(newFilePath, lastModifiedDate) {
        let newFile = null;

        //if the file does not already exist
        if(this.getFileIdFromFilePath(newFilePath) === null) {
            //pick apart the relative file path
            const fileInfo = path.posix.parse(newFilePath);
            //get the path to the containing directory (make sure it ends with a separator)
            const newFileParentPath = utilities.addEndingPathSeparator(fileInfo.dir);
            //retrieve the parent dir id based on the path to the parent dir
            const newFileParentDirId = this.getDirIdFromDirPath(newFileParentPath);
            
            //if the parent dir is being tracked
            if(this.allDirs[newFileParentDirId] && this.allDirs[newFileParentDirId].isDeleted === 'false') {
                //create a new file object
                newFile = new File(newFileParentDirId, newFilePath, lastModifiedDate);

                //make a connection between the file path and an id 
                this.pathToFileIdMap[newFilePath] = newFile.id;

                //add the file to the object of all files
                this.allFiles[newFile.id] = newFile;
            } else {
                throw new Error(`A new file cannot be created because the parent dir ${newFileParentPath} does not exist`);
            }
        } else {
            throw new Error(`A new file cannot be created because on already exists at ${newFilePath}`);
        }
        //return the newly created file object
        return newFile;
    }

    /*
     * Marks a file from the file system as deleted and removes its path to
     * id mapping.
     */
    removeFile(deletedFilePath) {
        //get the file id based on the file path
        const deletedFileId = this.getFileIdFromFilePath(deletedFilePath);
    
        //if the file is being tracked
        if(this.allFiles[deletedFileId] && this.allFiles[deletedFileId].isDeleted === 'false') {
            //delete the mapping from the old file path 
            delete this.pathToFileIdMap[deletedFilePath];

            //update the file in the collection of all files to be marked as deleted
            this.allFiles[deletedFileId].isDeleted = 'true';
        } else {
            throw new Error(`File: ${deletedFilePath} not tracked, cannot be removed`);
        }
    }

    /*
     * Renames a file.
     */
    renameFile(oldFilePath, newFilePath) {
        //get the id of the renamed file
        const fileId = this.getFileIdFromFilePath(oldFilePath);
    
        //if the file is being tracked
        if(this.allFiles[fileId] && this.allFiles[fileId].isDeleted === 'false') {
            //update the mapping from path to id
            this.replaceFilePathWithAnother(oldFilePath, newFilePath);

            //update the current name of the file in the collection of all files
            this.allFiles[fileId].currentPath = newFilePath;
        } else {
            throw new Error(`File: ${oldFilePath} not tracked, cannot be renamed`);
        }
    }

    /*
     * Moves a file.
     */
    moveFile(oldFilePath, newFilePath) {
        //get the id of the moved file
        const fileId = this.getFileIdFromFilePath(oldFilePath);
    
        //if the file is being tracked
        if(this.allFiles[fileId] && this.allFiles[fileId].isDeleted === 'false') {
            //get the new parent path (with an ending path separator)
            const fileInfo = path.posix.parse(newFilePath);
            const newFileParentPath = utilities.addEndingPathSeparator(fileInfo.dir);
            const newFileParentId = this.getDirIdFromDirPath(newFileParentPath);
            
            //if the parent dir is being tracked
            if(this.allDirs[newFileParentId] && this.allDirs[newFileParentId].isDeleted === 'false') {
                //update the mapping from path to id
                this.replaceFilePathWithAnother(oldFilePath, newFilePath);
        
                //update the new parent of the file in the collection of all files
                this.allFiles[fileId].parentDirectoryId = this.getDirIdFromDirPath(newFileParentPath);
                //update the current path of the file
                this.allFiles[fileId].currentPath = newFilePath;
            } else {
                throw new Error(`A new file cannot be moved because the new parent dir ${newFileParentPath} does not exist`);
            }
        } else {
            throw new Error(`File: ${oldFilePath} not tracked, cannot be moved`);
        }
    }

    /*
     * Adds a directory to the file system.
     */
    addDirectory(newDirPath) {
        let newDirectory = null;

        //if the dir does not already exist
        if(this.getDirIdFromDirPath(newDirPath) === null) {
            //pick apart the directory path 
            const dirInfo = path.posix.parse(newDirPath);
            //get the path to the containing directory (make sure it ends with a separator)
            const newDirParentPath = utilities.addEndingPathSeparator(dirInfo.dir);
            //holds the parent dir id
            let newDirParentDirId = null;
            //the root dir will have no name, a non-root dir will have one
            if(dirInfo.name !== '') {
                //retrieve the parent dir id based on the path to the parent dir
                newDirParentDirId = this.getDirIdFromDirPath(newDirParentPath);

                //if the parent is missing throw an exception
                if(newDirParentDirId === null) {
                    throw new Error(`A new file cannot be created because the parent dir ${newDirParentPath} does not exist`);
                }
            } //else- it is the root dir and its parent dir id will be null

            //create a new directory object
            newDirectory = new Directory(newDirParentDirId, newDirPath);

            //make a connection between the dir path and an id 
            this.pathToDirIdMap[newDirPath] = newDirectory.id;

            //add the directory to the object of all directories
            this.allDirs[newDirectory.id] = newDirectory;
        } else {
            throw new Error(`A new directory cannot be created because on already exists at ${newDirPath}`);
        }
        //return the newly created dir object
        return newDirectory;
    }

    /*
     * Marks a directory as deleted in the file system and removes the path  to
     * if mapping.
     */
    removeDirectory(deletedDirPath) {
        //get the deleted dir id based on the dir path
        const deletedDirId = this.getDirIdFromDirPath(deletedDirPath);
    
        //if the directory is being tracked
        if(this.allDirs[deletedDirId] && this.allDirs[deletedDirId].isDeleted === 'false') {
            //delete the mapping from the old dir path
            delete this.pathToDirIdMap[deletedDirPath];
            
            //update the dir in the collection of all dirs to be marked as deleted
            this.allDirs[deletedDirId].isDeleted = 'true';
    
            //recursively remove the children files and dirs
            this.removeDirectoryHelper(deletedDirId);
        } else {
            throw new Error(`Dir: ${deletedDirPath} not tracked, cannot be deleted`);
        }
    }

    /*
     * Helper that recursively removes the contents of a directory.
     */
    removeDirectoryHelper(deletedParentDirId) {
        //delete the child files
        for(const fileId in this.allFiles) {
            //if the file is a child of the deleted parent
            if(this.allFiles[fileId].parentDirectoryId === deletedParentDirId &&
               this.allFiles[fileId].isDeleted === 'false') {
                //remove all files in the passed in parent dir
                this.removeFile(this.allFiles[fileId].currentPath)
            }
        }
    
        //delete the child dirs
        for(const dirId in this.allDirs) {
            //if the directory is a child of the deleted parent
            if(this.allDirs[dirId].parentDirectoryId === deletedParentDirId &&
               this.allDirs[dirId].isDeleted === 'false') {
                //remove the dir (and its children recusrively) 
                this.removeDirectory(this.allDirs[dirId].currentPath);
            }
        }
    }

    /*
     * Rename a directory.
     */
    renameDirectory(oldDirPath, newDirPath) {
        //get the id of the renamed dir
        const dirId = this.getDirIdFromDirPath(oldDirPath);
    
        //if the directory is being tracked
        if(this.allDirs[dirId] && this.allDirs[dirId].isDeleted === 'false') {
            //update all of the path to id mappings for the renamed dir
            this.replaceDirectoryPathWithAnother(oldDirPath, newDirPath);

            //update the current path of the dir in the collection of all dirs
            this.allDirs[dirId].currentPath = newDirPath;

            //update the children recursively
            this.renameDirectoryHelper(dirId, oldDirPath, newDirPath);
        } else {
            throw new Error(`Dir: ${oldDirPath} not tracked, cannot be renamed`);
        }
    }

    /*
     * Helper that recursively updates the paths to the contents of a renamed
     * directory.
     */
    renameDirectoryHelper(renamedDirId, oldDirPath, newDirPath) {
        //rename the child files
        for(const fileId in this.allFiles) {
            //if the file is a child of the deleted parent
            if(this.allFiles[fileId].parentDirectoryId === renamedDirId &&
               this.allFiles[fileId].isDeleted === 'false') {
                //get the file's current path
                const originalFilePath = this.allFiles[fileId].currentPath;
                
                //if the file path begins with the old dir path 
                if(originalFilePath.startsWith(oldDirPath)) {
                    //swap out the old parent dir with the new one
                    const updatedFilePath = originalFilePath.replace(oldDirPath, newDirPath);
                    
                    //delete the mapping from the old dir path 
                    this.replaceFilePathWithAnother(originalFilePath, updatedFilePath);
        
                    //update the file in the collection of all files
                    this.allFiles[fileId].currentPath = updatedFilePath;
                }
            }
        }
    
        //rename the child dirs
        for(const dirId in this.allDirs) {
            //if the directory is a child of the deleted parent
            if(this.allDirs[dirId].parentDirectoryId === renamedDirId &&
               this.allDirs[dirId].isDeleted === 'false') {
                //get the dir's current path
                const originalDirPath = this.allDirs[dirId].currentPath;

                //if the dir path begins with the old dir path ()
                if(originalDirPath.startsWith(oldDirPath)) {
                    //swap out the old parent dir with the new one
                    const updatedDirPath = originalDirPath.replace(oldDirPath, newDirPath);
                    
                    //delete the mapping from the old dir path 
                    this.replaceDirectoryPathWithAnother(originalDirPath, updatedDirPath);
        
                    //update the dir in the collection of all files
                    this.allDirs[dirId].currentPath = updatedDirPath;
        
                    //recursively rename the children
                    this.renameDirectoryHelper(dirId, originalDirPath, updatedDirPath);
                }
            }
        }
    }
    
    /*
     * Moves a directory.
     */
    moveDirectory(oldDirPath, newDirPath) {
        //get the id of the moved dir
        const dirId = this.getDirIdFromDirPath(oldDirPath);
    
        //if the dir is being tracked
        if(this.allDirs[dirId] && this.allDirs[dirId].isDeleted === 'false') {
            //get the new parent path of the dir (make sure it ends with a separator)
            const dirInfo = path.posix.parse(newDirPath);
            const newDirParentPath = utilities.addEndingPathSeparator(dirInfo.dir);
            const newDirParentId = this.getDirIdFromDirPath(newDirParentPath);

            //if the new parent dir is being tracked
            if(this.allDirs[newDirParentId] && this.allDirs[newDirParentId].isDeleted === 'false') {
                //update the mapping from path to id
                this.replaceDirectoryPathWithAnother(oldDirPath, newDirPath);

                //update the new parent of the dir in the collection of all dirs
                this.allDirs[dirId].parentDirectoryId = newDirParentId;
                //update the current path of the dir in the collection of all dirs
                this.allDirs[dirId].currentPath = newDirPath;
        
                //recursively update the child files and dirs
                this.renameDirectoryHelper(dirId, oldDirPath, newDirPath);
            } else {
                throw new Error(`A dir cannot be moved because the new parent dir ${newDirParentPath} does not exist`);
            }
        } else {
            throw new Error(`Dir: ${oldDirPath} not tracked, cannot be moved`);
        }
    }

    /*
     * Look at all the active files on the disk and update the last modified
     * date.
     */
    updateLastModifiedDates() {
        //go through all of the files being tracked
        for(let fileId in this.allFiles) {
            const file = this.allFiles[fileId];

            //if the file is still present
            if(file.isDeleted === 'false') {
                //get some file stats
                const stats = fs.statSync(path.join(this.storytellerDirPath, file.currentPath));
                //if the last modified date is different
                if(file.lastModifiedDate !== stats.mtimeMs) {
                    //store the new value
                    file.lastModifiedDate = stats.mtimeMs;
                }
            }
        }
    }
    
    /*
     * Returns a File object based on its id.
     */
    getFileInfo(fileId) {
        //attempt to get the file info based on its id
        const retVal = this.allFiles[fileId];
    
        //if the file cannot be retrieved
        if(!retVal) {
            throw new Error(`Cannot retrieve a file for the file id ${fileId}.`);
        }
    
        return retVal;
    }
    
    /*
     * Returns a File object based on the path to the file.
     */
    getFileInfoFromFilePath(filePath) {
        //use getFileInfo to get the id from the file path 
        return this.getFileInfo(this.getFileIdFromFilePath(filePath));
    }

    /*
     * Returns a directory object based on its id.
     */
    getDirInfo(dirId) {
        //attempt to get the dir info based on its id
        const retVal = this.allDirs[dirId];
    
        //if the dir cannot be retrieved
        if(!retVal) {
            throw new Error(`Cannot retrieve a dir for the dir id ${dirId}.`);
        }
    
        return retVal;
    }

    /*
     * Returns a Directory object based on its path.
     */
    getDirInfoFromDirPath(dirPath) {
        //use getDirInfo to get the id from the dir path 
        return this.getDirInfo(this.getDirIdFromDirPath(dirPath));
    }

    /*
     * Gets the file id from a file path.
     */
    getFileIdFromFilePath(filePath) {
        //retrieve the id from the path
        let retVal = this.pathToFileIdMap[filePath];
    
        //if the path is not present
        if(!retVal) {
            //explicitly store null
            retVal = null;
        }
        return retVal;
    }

    /*
     * Gets a directory id from a directory path.
     */
    getDirIdFromDirPath(dirPath) {
        //retrieve the id from the path
        let retVal = this.pathToDirIdMap[dirPath];
        
        //if the path is not present
        if(!retVal) {
            //explicitly store null
            retVal = null;
        }
        return retVal;
    }

    /*
     * Used when you aren't sure if you have a file or a directory path
     * to retrieve the id.
     */
    getIdFromFileOrDirPath(path) {
        //hold the id of the file or directory in the path parameter
        let retVal;
    
        //first try the path as a file path
        retVal = this.getFileIdFromFilePath(path);
        
        //if there is not id for the file path
        if(retVal === null) {
            //attempt tp retrieve the id as a dir path
            retVal = this.getDirIdFromDirPath(path);
        }
    
        return retVal;
    }

    /*
     * Replaces a mapping from a file path to id.
     */
    replaceFilePathWithAnother(oldFilePath, newFilePath) {
        //if the path to id mapping exists
        if(this.pathToFileIdMap[oldFilePath]) {
            //get the file id based on the old path
            const id = this.pathToFileIdMap[oldFilePath];
    
            //delete the mapping from the old path 
            delete this.pathToFileIdMap[oldFilePath];
            
            //create a new mapping from the new file/dir path to the id 
            this.pathToFileIdMap[newFilePath] = id;
        } else {
            throw new Error(`No path to id mapping exists for '${oldFilePath}'`);
        }
    }

    /*
     * Replaces a mapping from a directory path to id.
     */
    replaceDirectoryPathWithAnother(oldDirPath, newDirPath) {
        //if the path to id mapping exists
        if(this.pathToDirIdMap[oldDirPath]) {
            //get the file id based on the old path
            const id = this.pathToDirIdMap[oldDirPath];
    
            //delete the mapping from the old path 
            delete this.pathToDirIdMap[oldDirPath];
            
            //create a new mapping from the new file/dir path to the id 
            this.pathToDirIdMap[newDirPath] = id;
        } else {
            throw new Error(`No path to id mapping exists for '${oldDirPath}'`);
        }
    }
}

module.exports = FileSystemManager;