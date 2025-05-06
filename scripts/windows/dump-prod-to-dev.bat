
@echo off 
chcp 1250
mongodump --config="C:\Users\�ron\chungus-battles-backend\config.prod.yaml" --collection=talents 
mongorestore --config="C:\Users\�ron\chungus-battles-backend\config.dev.yaml" --drop --collection=talents dump/chungus/talents.bson 
mongodump --config="C:\Users\�ron\chungus-battles-backend\config.prod.yaml" --collection=items 
mongorestore --config="C:\Users\�ron\chungus-battles-backend\config.dev.yaml" --drop --collection=items dump/chungus/items.bson
pause