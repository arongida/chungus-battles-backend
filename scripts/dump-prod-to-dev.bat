
@echo off 
chcp 1250
mongodump --config="C:\Users\햞on\chungus-battles-backend\config.prod.yaml" --collection=talents 
mongorestore --config="C:\Users\햞on\chungus-battles-backend\config.dev.yaml" --drop --collection=talents dump/chungus/talents.bson 
mongodump --config="C:\Users\햞on\chungus-battles-backend\config.prod.yaml" --collection=items 
mongorestore --config="C:\Users\햞on\chungus-battles-backend\config.dev.yaml" --drop --collection=items dump/chungus/items.bson 
mongodump --config="C:\Users\햞on\chungus-battles-backend\config.prod.yaml" --collection=itemcollections 
mongorestore --config="C:\Users\햞on\chungus-battles-backend\config.dev.yaml" --drop --collection=itemcollections dump/chungus/itemcollections.bson 
pause